"""Pick a shot-detector setting whose shot counts match the paper's (Google Video Intelligence).

Copies N videos from Box, runs several PySceneDetect settings on each, and compares
own shot count (cuts + 1) with the paper's shot count (shotc_ps x duration).
Videos are spread across batches (every k-th row of the inventory).

Usage:
  python tune_shots.py --inventory out\\inventory.csv --csv C:\\dev\\video-analysis\\data\\pmsv_dataset.csv --n 20
"""
import argparse, shutil, tempfile
from pathlib import Path
import numpy as np
import pandas as pd
from extract_features import shot_cuts

CONFIGS = [("content", 27), ("content", 22), ("content", 18), ("content", 15),
           ("adaptive", 3), ("adaptive", 2)]

ap = argparse.ArgumentParser()
ap.add_argument("--inventory", required=True, type=Path)
ap.add_argument("--csv", required=True, type=Path)
ap.add_argument("--n", default=20, type=int)
a = ap.parse_args()

inv = pd.read_csv(a.inventory, dtype={"video_id": str})
inv = inv[inv.in_dataset].reset_index(drop=True)
inv = inv.iloc[np.linspace(0, len(inv) - 1, a.n).astype(int)]
ds = pd.read_csv(a.csv, dtype={"video_id": str}).set_index("video_id")

rows = []
tmp = Path(tempfile.mkdtemp(prefix="pmsv_tune_"))
try:
    for i, r in enumerate(inv.itertuples(), 1):
        local = Path(shutil.copyfile(r.path, tmp / f"{r.video_id}.mp4"))
        paper = ds.loc[r.video_id, "shotc_ps"] * ds.loc[r.video_id, "duration"]
        row = {"video_id": r.video_id, "paper": paper}
        for det, th in CONFIGS:
            row[f"{det}:{th}"] = len(shot_cuts(local, det, th)) + 1
        rows.append(row)
        local.unlink()
        print(f"{i}/{len(inv)} {r.video_id}: paper {paper:.0f} | " +
              " ".join(f"{k}={v}" for k, v in row.items() if ":" in k))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

t = pd.DataFrame(rows)
print(f"\npaper shots: mean {t.paper.mean():.1f}\n")
print(f"{'setting':12s} {'mean':>6s} {'MAE':>6s} {'r':>6s}")
for k in [c for c in t.columns if ":" in c]:
    print(f"{k:12s} {t[k].mean():6.1f} {(t[k]-t.paper).abs().mean():6.2f} {t[k].corr(t.paper):6.2f}")
t.to_csv("out/tune_shots.csv", index=False)
