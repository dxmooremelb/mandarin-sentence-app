#!/usr/bin/env python3
"""Download level audio and rebuild GitHub Pages JSON."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app import DEFAULT_FOLDER, sync_static_site, list_levels


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync sentence spreadsheets into static site data.")
    parser.add_argument("--folder", type=Path, default=DEFAULT_FOLDER, help="Folder containing level spreadsheets")
    parser.add_argument("--level", default="", help="Optional level id or label, such as level-32-sentences or 'Level 32'")
    parser.add_argument("--skip-audio", action="store_true", help="Only rebuild JSON; do not download audio")
    args = parser.parse_args()

    folder = args.folder.expanduser()
    if not list_levels(folder):
        print(f"Could not find any .xlsx or .csv files in {folder}", file=sys.stderr)
        return 1

    summary = sync_static_site(folder, args.level, args.skip_audio)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    audio = summary["audio"]
    failed = int(audio.get("failed", 0)) if isinstance(audio, dict) else 0
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
