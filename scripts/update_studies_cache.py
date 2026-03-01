#!/usr/bin/env python3
import argparse
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app import STUDIES_CACHE_PATH, deck  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update cached studies from RSS + PubMed sources.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore weekly fetch interval and fetch immediately.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    deck.force_refresh(allow_external_fetch=True, force_external_fetch=args.force)
    print("cache_path", STUDIES_CACHE_PATH)
    print("total_loaded", len(deck.items))
    print("last_fetch_iso", deck._last_refresh_iso())
    if deck.last_error:
        print("warnings", deck.last_error)
    else:
        print("warnings", "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
