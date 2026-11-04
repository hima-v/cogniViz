"""Step 6: controls for the windowed models. Every model here includes video length.

Same Random Forest, same RepeatedKFold 10x10 folds as compare_rf.py. Reference = own_whole + length.
For each k in 3, 5, 10:
  concat      windows side by side (feature_w1, feature_w2, ...) + length   -> does time add beyond length?
  shuffled    same, but each video's windows put in a random order          -> does window POSITION matter?
  summary     per feature across windows: mean, sd, min, max, slope         -> is it VARIABILITY, not timing?
  late_fusion one RF per window position, predictions averaged              -> a different fusion method
"""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.base import clone
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import RepeatedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

P = dict(random_state=0, max_depth=7, max_features="log2", min_samples_split=5, n_estimators=30)
N_SPLITS, N_REPEATS = 10, 10
FEATS = ["brightness", "saturation", "warmness", "entropy", "loudness", "spec_centroid",
         "shotc_ps", "shotd_ps", "tempo"]

ap = argparse.ArgumentParser()
ap.add_argument("--csv", required=True, type=Path)
ap.add_argument("--out", default="out", type=Path)
ap.add_argument("--cv-seed", default=1, type=int)
ap.add_argument("--shuffle-seed", default=0, type=int)
a = ap.parse_args()
fdir = a.out / "features"

ds = pd.read_csv(a.csv, dtype={"video_id": str})
meta = pd.read_csv(fdir / "meta.csv", dtype={"video_id": str})
ids = ds[["video_id", "perceived_msv"]].merge(meta[["video_id", "log_length"]], on="video_id")
ids = ids.sort_values("video_id").reset_index(drop=True)          # same order as compare_rf.py
y = ids.perceived_msv.to_numpy()
L = ids[["log_length"]].to_numpy()


def table(name):
    t = ids[["video_id"]].merge(pd.read_csv(fdir / f"{name}.csv", dtype={"video_id": str}), on="video_id", how="left")
    return t.drop(columns="video_id").fillna(0.0)


def cube(k):
    """videos x windows x features"""
    t = table(f"k{k}")
    return np.stack([t[[f"{f}_w{i}" for f in FEATS]].to_numpy() for i in range(1, k + 1)], axis=1)


def summary(C):
    idx = np.arange(C.shape[1]) - (C.shape[1] - 1) / 2
    slope = (C * idx[None, :, None]).sum(1) / (idx ** 2).sum()
    return np.hstack([C.mean(1), C.std(1), C.min(1), C.max(1), slope])


def shuffled(C, seed):
    rng = np.random.default_rng(seed)
    out = C.copy()
    for v in range(len(C)):                    # a different random order for every video
        out[v] = C[v, rng.permutation(C.shape[1])]
    return out


model = make_pipeline(StandardScaler(), RandomForestRegressor(**P))
cv = list(RepeatedKFold(n_splits=N_SPLITS, n_repeats=N_REPEATS, random_state=a.cv_seed).split(L))


def fold_mse(Xs, tr, te):
    """Xs: one matrix (single model) or a list of matrices (late fusion: one model each, averaged)."""
    Xs = Xs if isinstance(Xs, list) else [Xs]
    pred = np.mean([clone(model).fit(X[tr], y[tr]).predict(X[te]) for X in Xs], axis=0)
    return float(np.mean((pred - y[te]) ** 2))


conditions = {"own_whole + len": np.hstack([table("whole")[FEATS].to_numpy(), L])}
for k in (3, 5, 10):
    C = cube(k)
    flat = lambda c: c.reshape(len(c), -1)
    conditions[f"k{k} concat + len"] = np.hstack([flat(C), L])
    conditions[f"k{k} shuffled + len"] = np.hstack([flat(shuffled(C, a.shuffle_seed)), L])
    conditions[f"k{k} summary + len"] = np.hstack([summary(C), L])
    conditions[f"k{k} late_fusion + len"] = [np.hstack([C[:, i, :], L]) for i in range(k)]

scores = {}
for name, X in conditions.items():
    scores[name] = np.array(Parallel(n_jobs=-1)(delayed(fold_mse)(X, tr, te) for tr, te in cv))
    print(f"  {name:24s} done")

ref = scores["own_whole + len"]
rows = []
for name, s in scores.items():
    X = conditions[name]
    nf = X.shape[1] if not isinstance(X, list) else f"{len(X)}x{X[0].shape[1]}"
    per_rep = s.reshape(N_REPEATS, N_SPLITS).mean(1)
    rows.append({"condition": name, "n_features": nf, "cv_mse": per_rep.mean(),
                 "sd_across_repeats": per_rep.std(ddof=1), "diff_vs_whole_len": (s - ref).mean(),
                 "folds_better": (s < ref).mean()})
res = pd.DataFrame(rows)
print(f"\nvideos: {len(y)}   target variance: {y.var():.4f}   all models include log video length\n")
print(res.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
res.to_csv(a.out / "rf_controls.csv", index=False)
print(f"\nwrote {a.out/'rf_controls.csv'}")
