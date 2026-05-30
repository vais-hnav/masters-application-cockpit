#!/usr/bin/env python3
"""Create the Cloudflare Pages static output directory."""

from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


def copy_file(source: str, destination: str | None = None) -> None:
    destination_path = DIST / (destination or source)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / source, destination_path)


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    for file_name in ("index.html", "styles.css", "app.js", "_routes.json"):
        copy_file(file_name)

    shutil.copytree(ROOT / "data", DIST / "data")
    print(f"Built {DIST}")


if __name__ == "__main__":
    main()
