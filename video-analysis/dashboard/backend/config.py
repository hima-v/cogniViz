from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
CFG = yaml.safe_load((HERE / "config.yaml").read_text())
ROOT = Path(CFG["root"])


def path(rel: str) -> Path:
    return ROOT / rel


DATA_DIR = path(CFG["data_dir"])
DETAILS_DIR = DATA_DIR / "details"
THUMBS_DIR = DATA_DIR / "thumbs"
