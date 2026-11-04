"""Step 4: same Random Forest, same folds, different feature tables.

Usage:
  python compare_rf.py --csv C:/dev/video-analysis/data/msv_df_imputed.csv --out out
"""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import RepeatedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from common import PAPER_F11, PAPER_NO_FACE

P = dict(random_state=0, max_depth=7, max_features="log2", min_samples_split=5, n_estimators=30)
N_SPLITS, N_REPEATS = 10, 10

ap = argparse.ArgumentParser()
ap.add_argument("--csv", required=True, type=Path)
ap.add_argument("--id-col", default="video_id")
ap.add_argument("--target", default="perceived_msv")
ap.add_argument("--out", default="out", type=Path)
ap.add_argument("--cv-seed", default=1, type=int)
a = ap.parse_args()

fdir = a.out / "features"
paper = pd.read_csv(a.csv, dtype={a.id_col: str}).rename(columns={a.id_col: "video_id"})
meta = pd.read_csv(fdir / "meta.csv", dtype={"video_id": str})
own = {c: pd.read_csv(fdir / f"{c}.csv", dtype={"video_id": str})
       for c in ["whole", "k3", "k5", "k10", "first3", "first5", "eml"] if (fdir / f"{c}.csv").exists()}

# One fixed set of videos, in one fixed order, for every condition
ids = paper[["video_id", a.target]].merge(meta[["video_id", "log_length"]], on="video_id")
ids = ids.sort_values("video_id").reset_index(drop=True)
y = ids[a.target].to_numpy()


def X_of(table, cols=None):
    t = ids[["video_id"]].merge(table, on="video_id", how="left")
    X = t.drop(columns="video_id") if cols is None else t[cols]
    return X.fillna(0.0).to_numpy()  # NaN only if a window had no data


own_whole = own["whole"].merge(meta[["video_id", "log_length"]], on="video_id")
conditions = {
    "paper_11 (their features)": X_of(paper, PAPER_F11),
    "paper_9 (no faces)": X_of(paper, PAPER_NO_FACE),
    "own_whole": X_of(own["whole"]),
    "own_whole + log_length": X_of(own_whole),
}
for c in ["k3", "k5", "k10", "first3", "first5", "eml"]:
    if c in own:
        conditions[f"own_{c}"] = X_of(own[c])

cv = RepeatedKFold(n_splits=N_SPLITS, n_repeats=N_REPEATS, random_state=a.cv_seed)
model = make_pipeline(StandardScaler(), RandomForestRegressor(**P))  # scaler fit inside each fold

scores = {}
for name, X in conditions.items():
    s = -cross_val_score(model, X, y, cv=cv, scoring="neg_mean_squared_error", n_jobs=-1)
    scores[name] = s
    print(f"  {name:28s} done")

ref = scores["own_whole"]
rows = []
for name, s in scores.items():
    per_rep = s.reshape(N_REPEATS, N_SPLITS).mean(axis=1)   # 10-fold MSE of each repeat
    d = s - ref                                             # paired, same fold
    rows.append({"condition": name, "n_features": conditions[name].shape[1],
                 "cv_mse": per_rep.mean(), "sd_across_repeats": per_rep.std(ddof=1),
                 "diff_vs_own_whole": d.mean(), "folds_better_than_own_whole": (d < 0).mean()})
res = pd.DataFrame(rows)
print(f"\nvideos: {len(y)}   target variance: {y.var():.4f}   CV: RepeatedKFold {N_SPLITS}x{N_REPEATS}, seed {a.cv_seed}\n")
print(res.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
res.to_csv(a.out / "rf_comparison.csv", index=False)
print(f"\nwrote {a.out/'rf_comparison.csv'}")
