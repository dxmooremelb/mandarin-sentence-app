#!/usr/bin/env python3
"""Simple local Mandarin sentence browser.

Run:
  python3 app.py

Optional:
  python3 app.py --folder ./Sentences
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import webbrowser
import zipfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

BASE_DIR = Path(__file__).resolve().parent
APP_TITLE = "Mandarin Sentences"

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

DEFAULT_FOLDER = BASE_DIR / "Sentences"
AUDIO_LIBRARY_DIR = BASE_DIR / "audio_library"
AUDIO_FIELDS = ("Audio 1", "Audio 2")
STATIC_DATA_DIR = BASE_DIR / "data"
LEGACY_AUDIO_MARKER = "Mandarin" + "_Blueprint"
OFFLINE_MANIFEST_PATH = BASE_DIR / "offline-assets.json"
APP_ASSETS = (
    "./",
    "index.html",
    "manifest.webmanifest",
    "service-worker.js",
    "static/styles.css?v=20260607-1",
    "static/app.js?v=20260607-1",
)


def col_to_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref.upper())
    if not letters:
        return 0
    total = 0
    for ch in letters.group(0):
        total = total * 26 + (ord(ch) - 64)
    return total - 1


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    values: list[str] = []
    for si in root.findall("main:si", NS):
        parts = [t.text or "" for t in si.findall(".//main:t", NS)]
        values.append("".join(parts))
    return values


def first_sheet_path(zf: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))

    first_sheet = workbook.find("main:sheets/main:sheet", NS)
    if first_sheet is None:
        raise ValueError("No worksheets found in workbook.")

    rel_id = first_sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    if not rel_id:
        raise ValueError("Could not resolve first worksheet relationship.")

    for rel in rels:
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib["Target"]
            return "xl/" + target.lstrip("/") if not target.startswith("xl/") else target
    raise ValueError("Could not find worksheet file in workbook relationships.")


def cell_text(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "s":
        v = cell.find("main:v", NS)
        if v is None or v.text is None:
            return ""
        idx = int(v.text)
        return shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
    if cell_type == "inlineStr":
        return "".join(t.text or "" for t in cell.findall(".//main:t", NS))
    v = cell.find("main:v", NS)
    return v.text if v is not None and v.text is not None else ""


def extract_characters(raw_text: str) -> str:
    match = re.search(
        r"Characters:\s*(.*?)(?:\n\s*(?:Personal Notes|Picture|Add to reviews|Level\s+\d+)\b|$)",
        raw_text or "",
        flags=re.S,
    )
    if not match:
        return ""
    chars = re.findall(r"[\u3400-\u9fff]", match.group(1))
    seen: list[str] = []
    for ch in chars:
        if ch not in seen:
            seen.append(ch)
    return " ".join(seen)


def level_number(path: Path) -> int:
    match = re.search(r"level\s*(\d+)", path.stem, flags=re.I)
    return int(match.group(1)) if match else -1


def level_label(path: Path) -> str:
    number = level_number(path)
    return f"Level {number}" if number >= 0 else path.stem


def level_slug(path: Path) -> str:
    number = level_number(path)
    if number >= 0:
        return f"level-{number}-sentences"
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")


def audio_field_slug(audio_field: str) -> str:
    return audio_field.lower().replace(" ", "-")


def url_extension(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in {".mp3", ".m4a", ".wav", ".ogg", ".aac"} else ".mp3"


def local_audio_path(level_id: str, card_number: int, audio_field: str, url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:10]
    filename = f"{card_number:04d}-{audio_field_slug(audio_field)}-{digest}{url_extension(url)}"
    return AUDIO_LIBRARY_DIR / level_id / audio_field_slug(audio_field) / filename


def local_audio_url(path: Path) -> str:
    return path.relative_to(BASE_DIR).as_posix()


def card_number_from_id(card_id: str) -> int:
    try:
        return int(str(card_id).split(":")[-1])
    except ValueError:
        return 0


def attach_local_audio(card: dict[str, str], level_id: str) -> dict[str, str]:
    card_number = card_number_from_id(card.get("id", "0"))
    for field in AUDIO_FIELDS:
        remote_url = (card.get(field) or "").strip()
        if not remote_url:
            continue
        card[f"{field} Remote"] = remote_url
        path = local_audio_path(level_id, card_number, field, remote_url)
        if path.exists() and path.stat().st_size > 0:
            card[field] = local_audio_url(path)
            card[f"{field} Local"] = "true"
        else:
            card[f"{field} Local"] = "false"
    return card


def list_levels(folder: Path) -> list[dict[str, str]]:
    if not folder.exists():
        return []

    files = [
        path for path in folder.iterdir()
        if path.suffix.lower() in {".xlsx", ".csv"} and not path.name.startswith("~$")
    ]
    files.sort(key=lambda path: (level_number(path), path.stem.lower()))
    return [
        {
            "id": level_slug(path),
            "label": level_label(path),
            "file": str(path),
            "filename": path.name,
            "count": len(read_spreadsheet(path, level_slug(path))),
        }
        for path in files
    ]


def level_path(folder: Path, level_id: str | None) -> Path | None:
    levels = list_levels(folder)
    if not levels:
        return None

    if level_id:
        selected = next((level for level in levels if level["id"] == level_id), None)
        if selected:
            return Path(selected["file"])

    return Path(levels[-1]["file"])


def read_xlsx(path: Path, level_id: str = "") -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Spreadsheet not found: {path}")

    with zipfile.ZipFile(path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_path = first_sheet_path(zf)
        root = ET.fromstring(zf.read(sheet_path))

        rows: list[list[str]] = []
        for row in root.findall(".//main:sheetData/main:row", NS):
            values: list[str] = []
            for cell in row.findall("main:c", NS):
                idx = col_to_index(cell.attrib.get("r", "A"))
                while len(values) <= idx:
                    values.append("")
                values[idx] = cell_text(cell, shared_strings)
            rows.append(values)

    if not rows:
        return []

    headers = [h.strip() for h in rows[0]]
    records: list[dict[str, str]] = []
    for i, row in enumerate(rows[1:], start=1):
        if not any(row):
            continue
        rec = {headers[j] if j < len(headers) and headers[j] else f"Column {j+1}": row[j] if j < len(row) else "" for j in range(max(len(headers), len(row)))}
        rec["id"] = f"{level_id}:{i}" if level_id else str(i)
        rec["characters"] = extract_characters(rec.get("Raw Text", ""))
        records.append(rec)
    return records


def read_csv(path: Path, level_id: str = "") -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Spreadsheet not found: {path}")

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)

    records: list[dict[str, str]] = []
    for i, row in enumerate(rows, start=1):
        rec = {str(key or "").strip(): str(value or "") for key, value in row.items()}
        if not any(rec.values()):
            continue
        rec["id"] = f"{level_id}:{i}" if level_id else str(i)
        rec["characters"] = extract_characters(rec.get("Raw Text", ""))
        records.append(rec)
    return records


def read_spreadsheet(path: Path, level_id: str = "") -> list[dict[str, str]]:
    if path.suffix.lower() == ".csv":
        return read_csv(path, level_id)
    return read_xlsx(path, level_id)


def audio_status_for_level(path: Path) -> dict[str, int | str]:
    level_id = level_slug(path)
    cards = read_spreadsheet(path, level_id)
    total = 0
    downloaded = 0
    for card in cards:
        card_number = card_number_from_id(card["id"])
        for field in AUDIO_FIELDS:
            remote_url = (card.get(f"{field} Remote") or card.get(field) or "").strip()
            if not remote_url:
                continue
            total += 1
            local_path = local_audio_path(level_id, card_number, field, remote_url)
            if local_path.exists() and local_path.stat().st_size > 0:
                downloaded += 1
    return {"level": level_id, "total": total, "downloaded": downloaded, "missing": total - downloaded}


def download_audio_file(url: str, target: Path) -> tuple[bool, str]:
    if target.exists() and target.stat().st_size > 0:
        return False, "exists"

    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_suffix(target.suffix + ".part")
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=45) as response:
        temp_path.write_bytes(response.read())
    temp_path.replace(target)
    return True, "downloaded"


def download_audio_library(folder: Path, only_level: str = "") -> dict[str, int | list[str]]:
    levels = list_levels(folder)
    selected = [level for level in levels if not only_level or level["id"] == only_level or level["label"].lower() == only_level.lower()]
    summary: dict[str, int | list[str]] = {"total": 0, "downloaded": 0, "skipped": 0, "failed": 0, "errors": []}
    jobs: list[tuple[dict[str, str], int, str, str, Path]] = []

    for level in selected:
        level_id = str(level["id"])
        cards = read_spreadsheet(Path(str(level["file"])), level_id)
        for card in cards:
            card_number = card_number_from_id(card["id"])
            for field in AUDIO_FIELDS:
                remote_url = (card.get(f"{field} Remote") or card.get(field) or "").strip()
                if not remote_url:
                    continue
                target = local_audio_path(level_id, card_number, field, remote_url)
                jobs.append((level, card_number, field, remote_url, target))

    summary["total"] = len(jobs)
    for index, (level, card_number, field, remote_url, target) in enumerate(jobs):
        try:
            downloaded, status = download_audio_file(remote_url, target)
            if downloaded:
                summary["downloaded"] = int(summary["downloaded"]) + 1
                print(f"Downloaded {level['label']} card {card_number} {field}")
            elif status == "exists":
                summary["skipped"] = int(summary["skipped"]) + 1
        except Exception as exc:
            message = f"{level['label']} card {card_number} {field}: {exc}"
            errors = summary["errors"]
            assert isinstance(errors, list)
            errors.append(message)
            print(f"Failed {message}", file=sys.stderr)

            network_unavailable = "nodename nor servname" in str(exc) or "Name or service not known" in str(exc)
            nothing_retrieved = int(summary["downloaded"]) == 0 and int(summary["skipped"]) == 0
            if network_unavailable and nothing_retrieved:
                remaining = len(jobs) - index
                summary["failed"] = int(summary["failed"]) + remaining
                errors.append("Network/DNS is unavailable, so the downloader stopped early.")
                break

            summary["failed"] = int(summary["failed"]) + 1

    return summary


def static_card(card: dict[str, str]) -> dict[str, str]:
    return dict(card)


def write_offline_manifest(output_dir: Path = STATIC_DATA_DIR) -> dict[str, int | str]:
    assets = list(APP_ASSETS)
    data_files = sorted(output_dir.rglob("*.json"))
    audio_files = sorted(AUDIO_LIBRARY_DIR.rglob("*"))
    for path in data_files + audio_files:
        if path.is_file() and path.name != ".DS_Store":
            assets.append(path.relative_to(BASE_DIR).as_posix())

    deduped = list(dict.fromkeys(assets))
    OFFLINE_MANIFEST_PATH.write_text(
        json.dumps({"assets": deduped}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"assets": len(deduped), "output": str(OFFLINE_MANIFEST_PATH)}


def export_static_site(folder: Path, output_dir: Path = STATIC_DATA_DIR) -> dict[str, int | str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    levels_dir = output_dir / "levels"
    levels_dir.mkdir(parents=True, exist_ok=True)

    exported_levels: list[dict[str, str | int]] = []
    exported_level_ids: set[str] = set()
    card_count = 0
    for level in list_levels(folder):
        level_id = str(level["id"])
        exported_level_ids.add(level_id)
        cards = [static_card(card) for card in read_spreadsheet(Path(str(level["file"])), level_id)]
        card_count += len(cards)
        level_payload = {
            "level": level_id,
            "levelLabel": level["label"],
            "filename": level["filename"],
            "count": len(cards),
            "cards": cards,
        }
        (levels_dir / f"{level_id}.json").write_text(
            json.dumps(level_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        exported_levels.append({
            "id": level_id,
            "label": level["label"],
            "filename": level["filename"],
            "count": len(cards),
        })

    payload = {
        "folder": "Sentences",
        "audioLibrary": "audio_library",
        "levels": exported_levels,
        "defaultLevel": exported_levels[-1]["id"] if exported_levels else "",
    }
    (output_dir / "levels.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    for old_level_file in levels_dir.glob("*.json"):
        if old_level_file.stem not in exported_level_ids:
            old_level_file.unlink()
    offline = write_offline_manifest(output_dir)
    return {
        "levels": len(exported_levels),
        "cards": card_count,
        "output": str(output_dir),
        "offlineAssets": int(offline["assets"]),
    }


def merge_translations(output_dir: Path = STATIC_DATA_DIR) -> dict[str, int]:
    """Merge persisted English translations back into exported level JSON files."""
    translations_path = output_dir / "translations.json"
    if not translations_path.exists():
        return {"merged": 0, "levels": 0}
    with open(translations_path, "r", encoding="utf-8") as f:
        all_trans = json.load(f)
    levels_dir = output_dir / "levels"
    total_merged = 0
    levels_updated = 0
    for lvl_str, lvl_trans in all_trans.items():
        level_file = levels_dir / f"level-{lvl_str}-sentences.json"
        if not level_file.exists():
            continue
        with open(level_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        merged = 0
        for i, card in enumerate(data["cards"], 1):
            t = lvl_trans.get(str(i))
            if t:
                card["English"] = t
                merged += 1
        if merged:
            with open(level_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            total_merged += merged
            levels_updated += 1
    return {"merged": total_merged, "levels": levels_updated}

def save_existing_translations(output_dir: Path = STATIC_DATA_DIR) -> int:
    """Before regenerating, back up any existing English translations from level JSONs."""
    translations_path = output_dir / "translations.json"
    existing = {}
    if translations_path.exists():
        with open(translations_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
    levels_dir = output_dir / "levels"
    saved = 0
    for level_file in sorted(levels_dir.glob("level-*-sentences.json")):
        lvl_num = level_file.stem.split("-")[1]
        with open(level_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        lvl_trans = {}
        for i, card in enumerate(data["cards"], 1):
            eng = card.get("English", "")
            if eng and eng != "No English available":
                lvl_trans[str(i)] = eng
        if lvl_trans:
            existing[lvl_num] = lvl_trans
            saved += len(lvl_trans)
    if saved:
        with open(translations_path, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
    return saved

def sync_static_site(folder: Path, only_level: str = "", skip_audio: bool = False) -> dict[str, object]:
    saved = save_existing_translations()
    export_summary = export_static_site(folder)
    translation_summary = merge_translations()
    return {"json": export_summary, "translations": dict(translation_summary, **{"previously_saved": saved})}


class Handler(SimpleHTTPRequestHandler):
    sentences_folder: Path

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        if parsed.path == "/api/levels":
            levels = list_levels(self.sentences_folder)
            self.send_json({
                "folder": str(self.sentences_folder),
                "audioLibrary": str(AUDIO_LIBRARY_DIR),
                "levels": levels,
                "defaultLevel": levels[-1]["id"] if levels else "",
            })
            return
        if parsed.path == "/api/audio-status":
            levels = [
                audio_status_for_level(Path(str(level["file"])))
                for level in list_levels(self.sentences_folder)
            ]
            self.send_json({"audioLibrary": str(AUDIO_LIBRARY_DIR), "levels": levels})
            return
        if parsed.path == "/api/cards":
            try:
                level_id = (qs.get("level") or [""])[0]
                path = level_path(self.sentences_folder, level_id)
                if path is None:
                    self.send_json({"error": f"No .xlsx or .csv files found in {self.sentences_folder}"}, status=404)
                    return
                selected_level = level_slug(path)
                data = read_spreadsheet(path, selected_level)
                self.send_json({
                    "level": selected_level,
                    "levelLabel": level_label(path),
                    "file": str(path),
                    "count": len(data),
                    "cards": data,
                })
            except Exception as exc:
                self.send_json({"error": str(exc)}, status=500)
            return
        if parsed.path in {"/", "/index.html"}:
            self.path = "/templates/index.html"
        return super().do_GET()


def main():
    parser = argparse.ArgumentParser(description="Local Mandarin sentence web app")
    parser.add_argument("--folder", type=Path, default=DEFAULT_FOLDER, help="Folder containing level spreadsheets")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--download-audio", action="store_true", help="Download all spreadsheet audio links into the local audio library")
    parser.add_argument("--export-static", action="store_true", help="Export static JSON data for GitHub Pages")
    parser.add_argument("--sync-static", action="store_true", help="Download missing audio, then rebuild static JSON for GitHub Pages")
    parser.add_argument("--skip-audio", action="store_true", help="Use with --sync-static to rebuild JSON without downloading audio")
    parser.add_argument("--level", default="", help="Limit --download-audio to a level id or label, such as level-29-sentences or 'Level 29'")
    args = parser.parse_args()

    sentences_folder = args.folder.expanduser()
    if not list_levels(sentences_folder):
        print(f"Could not find any .xlsx or .csv files in {sentences_folder}")
        print("Try: python3 app.py --folder /full/path/to/Sentences")
        sys.exit(1)

    if args.download_audio:
        summary = download_audio_library(sentences_folder, args.level)
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        sys.exit(0 if int(summary["failed"]) == 0 else 1)

    if args.sync_static:
        summary = sync_static_site(sentences_folder, args.level, args.skip_audio)
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        failed = int(summary["audio"].get("failed", 0)) if isinstance(summary["audio"], dict) else 0
        sys.exit(0 if failed == 0 else 1)

    if args.export_static:
        summary = export_static_site(sentences_folder)
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        sys.exit(0)

    Handler.sentences_folder = sentences_folder
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}"
    print(f"Serving levels from {sentences_folder}")
    print(f"Open {url}")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
