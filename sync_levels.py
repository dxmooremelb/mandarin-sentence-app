#!/usr/bin/env python3
"""Rebuild GitHub Pages JSON from level spreadsheets."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app import DEFAULT_FOLDER, list_levels, sync_static_site


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync sentence spreadsheets into static site data."
    )
    parser.add_argument(
        "--folder",
        type=Path,
        default=DEFAULT_FOLDER,
        help="Folder containing level spreadsheets",
    )
    parser.add_argument(
        "--level",
        default="",
        help="Optional level id or label, such as level-32-sentences or 'Level 32'",
    )
    args = parser.parse_args()

    folder = args.folder.expanduser()
    if not list_levels(folder):
        print(f"Could not find any .xlsx or .csv files in {folder}", file=sys.stderr)
        return 1

    summary = sync_static_site(folder, args.level, skip_audio=True)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
