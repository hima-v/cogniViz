"""Sanity check: do your re-extracted whole-video features agree with the paper's?

Usage:  python validate_whole.py --csv C:/dev/video-analysis/data/msv_df_imputed.csv --out out
"""
import argparse
from pathlib import Path
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--csv", required=True, type=Path)
ap.add_argument("--id-col", default="video_id")
ap.add_argument("--out", default="out", type=Path)
a = ap.parse_args()

paper = pd.read_csv(a.csv, dtype={a.id_col: str}).rename(columns={a.id_col: "video_id"})
own = pd.read_csv(a.out / "features" / "whole.csv", dtype={"video_id": str})
m = own.merge(paper, on="video_id", suffixes=("_own", "_paper"))
print(f"videos compared: {len(m)}\n")
print(f"{'feature':15s} {'r':>6s} {'own mean':>10s} {'paper mean':>11s}")
for f in [c[:-4] for c in m.columns if c.endswith("_own")]:
    if f + "_paper" in m:
        r = m[f + "_own"].corr(m[f + "_paper"])
        print(f"{f:15s} {r:6.2f} {m[f+'_own'].mean():10.3f} {m[f+'_paper'].mean():11.3f}")

meta = pd.read_csv(a.out / "features" / "meta.csv", dtype={"video_id": str})
if "duration" in paper:
    d = meta.merge(paper[["video_id", "duration"]], on="video_id", suffixes=("_own", "_paper"))
    diff = (d.duration_own - d.duration_paper).abs()
    print(f"\nduration: median |own - paper| = {diff.median():.3f} s, videos off by > 1 s: {(diff > 1).sum()}")
