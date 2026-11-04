"""Step 3: turn the per-bin features into one table per window condition.

Writes out/features/<condition>.csv (one row per video) and out/features/meta.csv.
Conditions:
  whole        one window = the whole video
  k3, k5, k10  k equal windows, relative to video length
  first3, first5   only the first 3 or 5 seconds
  eml          early = first 3 s, late = last 3 s, middle = the rest
               (videos shorter than 9 s fall back to equal thirds)

Per window: visual/audio features are bin means weighted by overlap with the window;
shotc_ps = shots in the window (cuts inside + 1) / window length  (paper: shot_count / videoDuration);
shotd_ps = mean length of the shot pieces inside the window / window length  (paper: shot_duration / videoDuration);
tempo    = 60 / median beat interval inside the window (0 if fewer than 3 beats).

Usage:  python build_windows.py --out out
"""
import argparse, json
from pathlib import Path
import numpy as np
import pandas as pd
from common import VISUAL, AUDIO

BIN_FEATS = VISUAL + AUDIO


def windows(cond, D):
    if cond == "whole":
        return {"": (0, D)}
    if cond.startswith("first"):
        s = float(cond[5:])
        return {"": (0, min(s, D))}
    if cond == "eml":
        if D < 9:
            return dict(zip(["early", "middle", "late"], windows("k3", D).values()))
        return {"early": (0, 3), "middle": (3, D - 3), "late": (D - 3, D)}
    k = int(cond[1:])
    edges = np.linspace(0, D, k + 1)
    return {f"w{i+1}": (edges[i], edges[i + 1]) for i in range(k)}


def window_feats(bins, ev, a, b):
    L = max(b - a, 1e-6)
    ov = (np.minimum(bins.t_end, b) - np.maximum(bins.t_start, a)).clip(lower=0)
    row = {f: float(np.average(bins[f], weights=ov)) if ov.sum() > 0 else np.nan for f in BIN_FEATS}

    cuts = np.array(ev["cuts"])
    row["shotc_ps"] = (float(((cuts > a) & (cuts < b)).sum()) + 1) / L  # shots touching the window, as in the paper
    bounds = np.unique(np.clip(np.concatenate([[0], cuts, [ev["duration"]]]), a, b))
    pieces = np.diff(bounds)
    row["shotd_ps"] = float(pieces[pieces > 0].mean()) / L if (pieces > 0).any() else 1.0

    beats = np.array(ev["beats"])
    beats = beats[(beats >= a) & (beats <= b)]
    row["tempo"] = 60.0 / float(np.median(np.diff(beats))) if len(beats) >= 3 else 0.0
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out", type=Path)
    ap.add_argument("--conditions", default="whole,k3,k5,k10,first3,first5,eml")
    a = ap.parse_args()
    conds = a.conditions.split(",")
    ev_files = sorted((a.out / "events").glob("*.json"))
    if not ev_files:
        raise SystemExit(f"no extracted videos in {a.out/'events'}; run extract_features.py first")
    tables = {c: [] for c in conds}
    meta = []
    for ef in ev_files:
        ev = json.loads(ef.read_text())
        vid, D = ev["video_id"], ev["duration"]
        bins = pd.read_csv(a.out / "bins" / f"{vid}.csv")
        meta.append({"video_id": vid, "duration": D, "log_length": np.log(D),
                     "has_audio": ev["has_audio"], "n_cuts": len(ev["cuts"])})
        for c in conds:
            row = {"video_id": vid}
            for wname, (s, e) in windows(c, D).items():
                sfx = f"_{wname}" if wname else ""
                row.update({f"{k}{sfx}": v for k, v in window_feats(bins, ev, s, e).items()})
            tables[c].append(row)

    fdir = a.out / "features"
    fdir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(meta).to_csv(fdir / "meta.csv", index=False)
    for c, rows in tables.items():
        t = pd.DataFrame(rows)
        t.to_csv(fdir / f"{c}.csv", index=False)
        n_nan = int(t.isna().sum().sum())
        print(f"{c:7s} videos={len(t):4d} columns={t.shape[1]-1:3d} NaNs={n_nan}")


if __name__ == "__main__":
    main()
