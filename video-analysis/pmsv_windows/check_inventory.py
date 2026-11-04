"""Step 1: match the video files in Box against the dataset, without opening any video.

Usage:
  python check_inventory.py --videos "C:/Users/<you>/Box/Video Data Analytics Reels Data" \
                            --csv "C:/dev/video-analysis/data/msv_df_imputed.csv" --out out
"""
import argparse
from pathlib import Path
import pandas as pd
from common import find_videos, video_id_from_name

ap = argparse.ArgumentParser()
ap.add_argument("--videos", required=True, type=Path)
ap.add_argument("--csv", required=True, type=Path)
ap.add_argument("--id-col", default="video_id", help="ID column in the dataset CSV")
ap.add_argument("--out", default="out", type=Path)
a = ap.parse_args()
a.out.mkdir(parents=True, exist_ok=True)

files = find_videos(a.videos)
inv = pd.DataFrame({"path": [str(p) for p in files],
                    "video_id": [video_id_from_name(p) for p in files],
                    "batch": [p.parent.name for p in files]})
df = pd.read_csv(a.csv, dtype={a.id_col: str})
ids = set(df[a.id_col].astype(str).str.strip())

dups = inv[inv.video_id.duplicated(keep=False)]
inv["in_dataset"] = inv.video_id.isin(ids)
missing = sorted(ids - set(inv.video_id))

print(f"video files found       : {len(inv)}")
print(f"per folder              :\n{inv.batch.value_counts().sort_index().to_string()}")
print(f"matched to dataset      : {inv.in_dataset.sum()} / {len(ids)}")
print(f"files not in dataset    : {(~inv.in_dataset).sum()}")
print(f"duplicate video IDs     : {dups.video_id.nunique()}")
print(f"dataset IDs with no file: {len(missing)}")

inv.to_csv(a.out / "inventory.csv", index=False)
pd.Series(missing, name="video_id").to_csv(a.out / "missing_ids.csv", index=False)
print(f"\nwrote {a.out/'inventory.csv'} and {a.out/'missing_ids.csv'}")
