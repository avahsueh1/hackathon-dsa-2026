from __future__ import annotations

from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
LOCAL_DATA_DIR = ROOT_DIR / "data" / "organizer"
SHARED_DATA_DIR = ROOT_DIR.parent / "data" / "raw"
DATA_DIR = LOCAL_DATA_DIR if LOCAL_DATA_DIR.exists() else SHARED_DATA_DIR
