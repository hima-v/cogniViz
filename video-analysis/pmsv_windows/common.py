"""Shared settings for the PMSV temporal-window pipeline."""
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".m4v"}

# Per-bin features written by extract_features.py
VISUAL = ["brightness", "saturation", "warmness", "entropy"]
AUDIO = ["loudness", "spec_centroid"]
# Paper's 11 features (msv_df_imputed.csv column names)
PAPER_F11 = ["tempo", "loudness", "spec_centroid", "brightness", "saturation", "entropy",
             "warmness", "facec_ps", "shotc_ps", "faced_ps", "shotd_ps"]
PAPER_NO_FACE = [f for f in PAPER_F11 if f not in ("facec_ps", "faced_ps")]


def video_id_from_name(path: Path) -> str:
    """'<video_id>+<post id>_<owner id>.mp4' -> '<video_id>'."""
    return path.stem.split("+")[0].strip()


def find_videos(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXTS)
