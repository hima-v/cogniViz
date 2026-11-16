"""Build every derived file the dashboard serves. Run once: python precompute.py

Reads only; writes only under backend/data/.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats as st
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestRegressor
from sklearn.manifold import TSNE
from sklearn.metrics import silhouette_score
from sklearn.model_selection import RepeatedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import labels as L
from config import CFG, DATA_DIR, DETAILS_DIR, ROOT, path
from stats import cliffs_delta

warnings.filterwarnings("ignore", category=FutureWarning)

FEATS = CFG["model"]["features"]
K_RANGE = range(4, 9)
DIFFUSE_SPREAD = 0.16  # median distance to medoid, as a share of the (unit) map width
RF_PARAMS = dict(n_estimators=30, max_depth=7, min_samples_split=5, max_features="log2", random_state=0)


# ---------------------------------------------------------------- load + derive
def load() -> pd.DataFrame:
    s = pd.read_csv(path(CFG["sources"]["share_csv"]), dtype={"survey_batch_id": str})
    assert s["survey_batch_id"].is_unique and len(s) == 1200
    assert s["sampled_cat"].value_counts().eq(150).all() and s["sampled_cat"].nunique() == 8
    s = s.set_index("survey_batch_id", drop=False)
    s.index.name = "id"

    s["no_face"] = s["face_count"] == 0
    s["silent"] = s["tempo"].isna()
    assert s["no_face"].sum() == 222 and s["faced_ps"].isna().sum() == 222
    assert s["silent"].sum() == 45
    assert (s[["tempo", "loudness", "spec_centroid"]].isna().all(axis=1) == s["silent"]).all()
    s["imputed"] = s["no_face"] | s["silent"]
    s = s.copy()

    imp = pd.read_csv(path(CFG["sources"]["features_csv"]), dtype={"video_id": str}).set_index("video_id")
    assert imp.index.is_unique and set(imp.index) == set(s.index), "imputed features must cover all 1,200 ids"
    for f in FEATS:
        s[f"{f}_imp"] = imp.loc[s.index, f].to_numpy()
    assert np.allclose(imp.loc[s.index, "perceived_msv"], s["msv_m"])

    s["issue"] = s["sampled_cat"]
    s["account_type"] = s["type"]
    s["tags"] = s[L.TAG_COLUMNS].apply(lambda r: [t for t in L.TAG_COLUMNS if r[t] == 1], axis=1)
    s["log_duration"] = np.log10(s["videoDuration"])
    eng = s["videoViewCount"] + s["likesCount"] + s["commentsCount"]  # NaN if any part is missing
    s["engagement"] = eng
    s["log_engagement"] = np.log10(eng + 1)
    s["ci95"] = 1.96 * s["msv_sd"] / np.sqrt(s["n"])
    ratio = s["dimensionsHeight"] / s["dimensionsWidth"]
    s["aspect"] = np.select([ratio > 1.2, ratio < 0.83, ratio.notna()], ["vertical", "landscape", "square"], "unknown")
    ts = pd.to_datetime(s["timestamp"], utc=True, errors="coerce")
    s["year"] = ts.dt.year.astype(float)
    s["posted"] = ts.dt.strftime("%Y-%m-%d")
    s["transcript_clean"] = s["transcript"].map(clean_transcript)
    s["has_speech"] = s["transcript_clean"].notna()

    inv_path = path(CFG["pipeline"]["inventory"])
    inv = pd.read_csv(inv_path, dtype={"video_id": str}).set_index("video_id") if inv_path.exists() else pd.DataFrame(columns=["path"])
    s["video_path"] = [inv["path"].get(i) if i in inv.index else None for i in s.index]
    s["has_video"] = s["video_path"].notna()
    bins_dir = path(CFG["pipeline"]["bins_dir"])
    have_bins = {p.stem for p in bins_dir.glob("*.csv")} if bins_dir.exists() else set()
    s["has_bins"] = s.index.isin(have_bins)
    return s


def clean_transcript(t) -> str | None:
    if not isinstance(t, str):
        return None
    t = t.strip()
    if t.startswith("[") and t.endswith("]"):
        t = t[1:-1].strip().strip("'\"").strip()
    return t or None


# ---------------------------------------------------------------- model
def oof_predictions(X: np.ndarray, y: np.ndarray) -> dict:
    rkf = RepeatedKFold(n_splits=10, n_repeats=10, random_state=1)
    preds = np.full((10, len(y)), np.nan)
    fold_mse = []
    for i, (tr, te) in enumerate(rkf.split(X)):
        m = make_pipeline(StandardScaler(), RandomForestRegressor(**RF_PARAMS)).fit(X[tr], y[tr])
        p = m.predict(X[te])
        preds[i // 10, te] = p
        fold_mse.append(float(np.mean((p - y[te]) ** 2)))
    assert not np.isnan(preds).any()
    return {"pred": preds.mean(0), "pred_sd": preds.std(0, ddof=1),
            "sq_err": ((preds - y) ** 2).mean(0), "cv_mse": float(np.mean(fold_mse)),
            "cv_mse_sd": float(np.std(fold_mse, ddof=1))}


# ---------------------------------------------------------------- projections + clusters
def unit(xy: np.ndarray) -> np.ndarray:
    lo, hi = xy.min(0), xy.max(0)
    span = (hi - lo).max()
    return (xy - lo) / span + (1 - (hi - lo) / span) / 2  # keep aspect, center in [0,1]


def projections(Z: np.ndarray) -> tuple[dict, dict]:
    import umap

    out, params = {}, {}
    out["tsne"] = unit(TSNE(n_components=2, perplexity=30, random_state=0, init="pca").fit_transform(Z))
    params["tsne"] = {"method": "t-SNE", "perplexity": 30, "seed": 0, "init": "pca"}
    out["umap"] = unit(umap.UMAP(n_neighbors=15, min_dist=0.1, random_state=0).fit_transform(Z))
    params["umap"] = {"method": "UMAP", "n_neighbors": 15, "min_dist": 0.1, "seed": 0}
    pca = PCA(n_components=2, random_state=0).fit(Z)
    out["pca"] = unit(pca.transform(Z))
    params["pca"] = {"method": "PCA", "explained_variance": [round(float(v), 4) for v in pca.explained_variance_ratio_]}
    for k, v in out.items():
        assert not np.isnan(v).any(), f"NaN coordinates in {k}"
    return out, params


def clusters(s: pd.DataFrame, Z: np.ndarray, coords: dict) -> tuple[dict, dict]:
    assignments, tables = {}, {}
    for k in K_RANGE:
        km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(Z)
        lab = km.labels_
        assignments[k] = lab
        rows = []
        for c in range(k):
            m = lab == c
            g = s[m]
            zs = {f: float(Z[m, FEATS.index(f)].mean()) for f in L.FEATURES}
            medoid, spread = {}, {}
            for meth, xy in coords.items():
                pts = xy[m]
                d = np.linalg.norm(pts[:, None, :] - pts[None, :, :], axis=2)
                mi = int(d.sum(1).argmin())
                medoid[meth] = [float(pts[mi, 0]), float(pts[mi, 1])]
                spread[meth] = float(np.median(d[mi]))
            rows.append({
                "cluster": c, "n": int(m.sum()), "mse": float(g["sq_err_oof"].mean()),
                "mean_rating": float(g["msv_m"].mean()),
                "ci95": float(1.96 * g["msv_m"].std(ddof=1) / math.sqrt(m.sum())),
                "issue_mix": {i: float((g["issue"] == i).mean()) for i in L.ISSUE_LABELS},
                "pct_popular": float((g["account_type"] == "popular").mean()),
                "profile": zs, "label": L.cluster_label(zs, 2), "medoid": medoid, "spread": spread,
                "diffuse": {meth: spread[meth] > DIFFUSE_SPREAD for meth in coords},
            })
        # Labels must be distinguishable within one k: lengthen duplicates.
        for n_terms in (3, 4):
            seen: dict[str, int] = {}
            for r in rows:
                seen[r["label"]] = seen.get(r["label"], 0) + 1
            for r in rows:
                if seen[r["label"]] > 1:
                    r["label"] = L.cluster_label(r["profile"], n_terms)
        tables[str(k)] = {"k": k, "silhouette": float(silhouette_score(Z, lab)), "clusters": rows}
    return assignments, tables


# ---------------------------------------------------------------- insights
def boot_mean_diff(a, b, n=2000, seed=0):
    rng = np.random.default_rng(seed)
    d = rng.choice(a, (n, len(a))).mean(1) - rng.choice(b, (n, len(b))).mean(1)
    return np.percentile(d, [2.5, 97.5])


def spearman(x, y):
    m = ~(np.isnan(x) | np.isnan(y))
    r, p = st.spearmanr(x[m], y[m])
    return float(r), float(p), int(m.sum())


def fmt(x, d=2):
    return f"{x:.{d}f}".replace("-", "−")


def insights(s: pd.DataFrame, experiments: pd.DataFrame | None) -> list[dict]:
    y = s["msv_m"].to_numpy()
    out = []

    # Issue gap
    g = s.groupby("issue")["msv_m"].agg(["mean", "std", "count"]).sort_values("mean", ascending=False)
    hi, lo = g.index[0], g.index[-1]
    out.append(dict(
        id="issue_gap", title="Issues differ in sensation rating",
        finding=(f"{L.ISSUE_LABELS[hi]} videos are rated highest (mean {fmt(g.loc[hi,'mean'])} ± {fmt(g.loc[hi,'std'])} SD) "
                 f"and {L.ISSUE_LABELS[lo]} lowest ({fmt(g.loc[lo,'mean'])} ± {fmt(g.loc[lo,'std'])}), "
                 f"a gap of {fmt(g.loc[hi,'mean'] - g.loc[lo,'mean'])} points on the 1–7 scale."),
        n=int(len(s)), method="Mean ± SD of the overall rating per sampled issue (150 videos each); gap = highest minus lowest mean.",
        stats={"by_issue": {i: {"mean": float(r["mean"]), "sd": float(r["std"]), "n": int(r["count"])} for i, r in g.iterrows()},
               "gap": float(g.loc[hi, "mean"] - g.loc[lo, "mean"])},
        sources=["authors_ratings", "authors_meta"],
        apply={"bottomTab": "attributes", "v3Mode": "issue", "colorBy": "issue"}))

    # Account type
    a = s.loc[s.account_type == "popular", "msv_m"].to_numpy()
    b = s.loc[s.account_type == "unpopular", "msv_m"].to_numpy()
    lo_ci, hi_ci = boot_mean_diff(a, b)
    cd = cliffs_delta(a, b)
    out.append(dict(
        id="account_type", title="Popular vs ordinary accounts",
        finding=(f"Videos from popular accounts average {fmt(a.mean())} vs {fmt(b.mean())} for ordinary accounts "
                 f"(difference {fmt(a.mean()-b.mean())}, 95% CI {fmt(lo_ci)} to {fmt(hi_ci)}; Cliff's δ = {fmt(cd)})."),
        n=int(len(s)), method="Difference in mean overall rating with 2,000-resample bootstrap CI; Cliff's delta as a rank-based effect size.",
        stats={"mean_popular": float(a.mean()), "mean_ordinary": float(b.mean()), "n_popular": len(a), "n_ordinary": len(b),
               "diff": float(a.mean() - b.mean()), "ci": [float(lo_ci), float(hi_ci)], "cliffs_delta": cd},
        sources=["authors_ratings", "authors_meta"],
        apply={"colorBy": "account", "bottomTab": "attributes", "v3Mode": "issue"}))

    # Length
    r, p, n = spearman(s["log_duration"].to_numpy(), y)
    out.append(dict(
        id="length", title="Longer videos are rated higher",
        finding=f"Sensation rating rises with video length (Spearman ρ = {fmt(r)}).",
        n=n, method="Spearman rank correlation of overall rating with log video length.",
        stats={"rho": r, "p": p}, sources=["authors_ratings", "authors_meta"],
        apply={"bottomTab": "attributes", "v3Mode": "scatter", "xAttribute": "log_duration"}))

    # Faces (videos with faces only)
    wf = s[~s.no_face]
    r, p, n = spearman(wf["faced_ps"].to_numpy(), wf["msv_m"].to_numpy())
    out.append(dict(
        id="faces", title="More face time, lower rating",
        finding=f"Among videos that show faces, more time with faces on screen goes with lower ratings (Spearman ρ = {fmt(r)}).",
        n=n, method="Spearman correlation of overall rating with share of time faces are on screen; videos with no faces excluded (their value would be imputed).",
        stats={"rho": r, "p": p, "n_excluded_no_face": int(s.no_face.sum())},
        sources=["authors_ratings", "authors_features"],
        apply={"bottomTab": "attributes", "v3Mode": "scatter", "xAttribute": "faced_ps", "filters": {"hideNoFace": True}}))

    # Editing pace
    r, p, n = spearman(s["shotd_ps"].to_numpy(), y)
    out.append(dict(
        id="editing", title="Longer shots, lower rating",
        finding=f"Videos with longer average shots tend to be rated lower (Spearman ρ = {fmt(r)}).",
        n=n, method="Spearman correlation of overall rating with the authors' mean shot length measure.",
        stats={"rho": r, "p": p}, sources=["authors_ratings", "authors_features"],
        apply={"bottomTab": "attributes", "v3Mode": "scatter", "xAttribute": "shotd_ps"}))

    # Dimensions
    rs = {k: float(np.corrcoef(s[col], y)[0, 1]) for k, (col, _, _) in L.DIMENSIONS.items() if k != "overall"}
    most_distinct = min(rs, key=rs.get)
    out.append(dict(
        id="dimensions", title="Novelty is the most distinct dimension",
        finding=(f"Emotional arousal tracks the overall rating almost exactly (r = {fmt(rs['arousal'])}), dramatic impact closely "
                 f"(r = {fmt(rs['dramatic'])}); {L.DIMENSIONS[most_distinct][2].lower()} is the most distinct (r = {fmt(rs[most_distinct])})."),
        n=int(len(s)), method="Pearson correlation of each dimension's mean with the overall mean across videos. Dimensions share items with the overall score, so high r is partly built in.",
        stats={"r": rs}, sources=["authors_ratings"],
        apply={"ratingTarget": most_distinct, "bottomTab": "attributes", "v3Mode": "issue", "colorBy": "rating"}))

    # Rater disagreement
    out.append(dict(
        id="disagreement", title="Raters often disagree",
        finding=(f"The median rater SD per video is {fmt(s['msv_sd'].median())} points; each video has {int(s['n'].min())}–{int(s['n'].max())} raters "
                 f"(median {int(s['n'].median())}), so the median 95% CI half-width is ±{fmt(s['ci95'].median())}."),
        n=int(len(s)), method="SD of the 17-item mean across raters, per video; CI = 1.96 · SD / √n.",
        stats={"median_sd": float(s["msv_sd"].median()), "n_min": int(s["n"].min()), "n_max": int(s["n"].max()),
               "median_ci95": float(s["ci95"].median())},
        sources=["authors_ratings"],
        apply={"showCI": True, "colorBy": "raterSd"}))

    # Engagement curve
    e = s.dropna(subset=["log_engagement"])
    q = pd.qcut(e["log_engagement"], 10, labels=False)
    bm = e.groupby(q).agg(x=("log_engagement", "median"), y=("msv_m", "mean"), n=("msv_m", "size"))
    r, p, n = spearman(e["log_engagement"].to_numpy(), e["msv_m"].to_numpy())
    rng = np.random.default_rng(0)
    xv, yv = e["log_engagement"].to_numpy(), e["msv_m"].to_numpy()
    quad = []
    for _ in range(1000):
        idx = rng.integers(0, len(xv), len(xv))
        quad.append(np.polyfit(xv[idx], yv[idx], 2)[0])
    qlo, qhi = np.percentile(quad, [2.5, 97.5])
    c2, c1, _ = np.polyfit(xv, yv, 2)
    vertex = -c1 / (2 * c2) if c2 != 0 else np.nan
    inverted_u = bool(qhi < 0 and np.quantile(xv, 0.1) < vertex < np.quantile(xv, 0.9))
    peak_bin = int(bm["y"].idxmax())
    vertex_pct = float((xv < vertex).mean() * 100) if inverted_u else None
    shape = (f"the fitted curve bends down after about percentile {vertex_pct:.0f} of engagement (a weak inverted U)" if inverted_u
             else "no clear inverted U: the binned means do not rise and then fall reliably")
    out.append(dict(
        id="engagement", title="Engagement and rating",
        finding=(f"Across engagement deciles, mean ratings range from {fmt(bm['y'].min())} to {fmt(bm['y'].max())} (highest in decile {peak_bin + 1}); "
                 f"{shape} (overall Spearman ρ = {fmt(r)})."),
        n=n, method=("Mean rating per decile of log10(views + likes + comments + 1); quadratic term tested with a 1,000-resample bootstrap "
                     f"(95% CI {fmt(qlo, 3)} to {fmt(qhi, 3)}). Videos with missing like counts excluded."),
        stats={"bins": bm.reset_index(drop=True).to_dict("records"), "rho": r, "quad_ci": [float(qlo), float(qhi)], "inverted_u": inverted_u,
               "n_missing": int(s["log_engagement"].isna().sum())},
        sources=["authors_ratings", "authors_meta"],
        apply={"bottomTab": "attributes", "v3Mode": "scatter", "xAttribute": "log_engagement"}))

    # Temporal
    if experiments is not None and len(experiments):
        ex = experiments.groupby(["condition", "table"], as_index=False)["cv_mse"].mean()
        ctl = ex[ex.table == "controls"]
        base = ctl[ctl.condition == "own_whole + len"]
        if len(base) and len(ctl):
            base_mse = float(base.cv_mse.iloc[0])
            best = ctl.loc[ctl.cv_mse.idxmin()]
            pairs = []
            for k in (3, 5, 10):
                o = ctl[ctl.condition == f"k{k} concat + len"].cv_mse
                sh = ctl[ctl.condition == f"k{k} shuffled + len"].cv_mse
                if len(o) and len(sh):
                    pairs.append((k, float(o.iloc[0]), float(sh.iloc[0])))
            ordered_wins = sum(o < sh for _, o, sh in pairs)
            n_seeds = int(experiments[experiments.table == "controls"]["seed"].nunique())
            out.append(dict(
                id="temporal", title="Window summaries beat whole-video features; order does not matter",
                finding=(f"The best condition ({best.condition}, CV MSE {fmt(best.cv_mse, 3)}) improves on whole-video features + length "
                         f"({fmt(base_mse, 3)}) by {fmt(base_mse - best.cv_mse, 3)}. Keeping windows in order beat shuffling them in "
                         f"{ordered_wins} of {len(pairs)} window counts, with differences under "
                         f"{fmt(max(abs(o - sh) for _, o, sh in pairs), 3)}, so the gain seems to come from variability, not timing."),
                n=960, method=f"10×10 CV Random Forest on our 9 re-extracted features; MSE averaged over {n_seeds} distinct run(s).",
                stats={"baseline": base_mse, "best": {"condition": best.condition, "cv_mse": float(best.cv_mse)},
                       "ordered_vs_shuffled": [{"k": k, "ordered": o, "shuffled": sh} for k, o, sh in pairs]},
                sources=["our_features", "our_analysis"],
                apply={"bottomTab": "experiments"}))
    else:
        out.append(dict(id="temporal", title="Temporal experiments", finding="Experiment results not found (run compare_rf.py and compare_controls.py).",
                        n=0, method="", stats={}, sources=["our_analysis"], apply={"bottomTab": "experiments"}))

    # Data quality
    both = int((s.no_face & s.silent).sum())
    out.append(dict(
        id="data_quality", title="Some feature values are imputed",
        finding=(f"{int(s.no_face.sum())} videos show no faces and {int(s.silent.sum())} have no audio ({both} both), so "
                 f"{int(s.imputed.sum())} videos carry filled-in values in the model's features."),
        n=int(len(s)), method="Face time is undefined without faces and audio features without sound; the model input file fills these with imputed values.",
        stats={"no_face": int(s.no_face.sum()), "silent": int(s.silent.sum()), "both": both, "any": int(s.imputed.sum())},
        sources=["authors_features"],
        apply={"colorBy": "imputed"}))

    for o in out:
        o["caveat"] = "Association, not cause." + (" Our 960-video subset." if o["id"] == "temporal" else "")
    return out


# ---------------------------------------------------------------- experiments
def load_experiments() -> pd.DataFrame | None:
    rows = []
    p = path(CFG["pipeline"]["rf_comparison"])
    if p.exists():
        d = pd.read_csv(p)
        for _, r in d.iterrows():
            rows.append({"table": "comparison", "condition": r.condition, "n_features": str(r.n_features), "seed": 0,
                         "cv_mse": float(r.cv_mse), "sd_across_repeats": float(r.sd_across_repeats)})
    seen = set()
    for spec in CFG["pipeline"].get("rf_controls", []):
        p = path(spec["file"])
        if not p.exists():
            continue
        d = pd.read_csv(p)
        h = hashlib.md5(d.round(9).to_csv(index=False).encode()).hexdigest()
        if h in seen:  # identical rerun, not an independent seed
            continue
        seen.add(h)
        for _, r in d.iterrows():
            rows.append({"table": "controls", "condition": r.condition, "n_features": str(r.n_features), "seed": spec["seed"],
                         "cv_mse": float(r.cv_mse), "sd_across_repeats": float(r.sd_across_repeats)})
    return pd.DataFrame(rows) if rows else None


# ---------------------------------------------------------------- validation + provenance
def validation(s: pd.DataFrame) -> dict:
    p = path(CFG["pipeline"]["features_dir"]) / "whole.csv"
    documented = {"visual": "1.00", "shots": "0.89", "audio": "0.53–0.77", "label": "from Week 2 report"}
    if not p.exists():
        return {"computed": None, "documented": documented}
    own = pd.read_csv(p, dtype={"video_id": str}).set_index("video_id")
    common = own.index.intersection(s.index)
    per = {}
    for f in ["brightness", "saturation", "warmness", "entropy", "shotc_ps", "shotd_ps", "loudness", "spec_centroid", "tempo"]:
        a, b = own.loc[common, f], s.loc[common, f]
        m = a.notna() & b.notna()
        per[f] = {"r": float(np.corrcoef(a[m], b[m])[0, 1]), "n": int(m.sum()), "label": L.FEATURE_WORDS[f][0]}
    groups = {"visual": ["brightness", "saturation", "warmness", "entropy"], "shots": ["shotc_ps", "shotd_ps"],
              "audio": ["loudness", "spec_centroid", "tempo"]}
    return {"computed": {"per_feature": per, "groups": {g: [min(per[f]["r"] for f in fs), max(per[f]["r"] for f in fs)] for g, fs in groups.items()},
                         "n_videos": int(len(common)), "method": "Pearson r between our whole-video features and the authors' raw features (same comparison as validate_whole.py)."},
            "documented": documented}


def mtime(p: Path) -> str | None:
    return datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M") if p.exists() else None


def rel(p: Path) -> str:
    return os.path.relpath(p, ROOT).replace("\\", "/")


def provenance(s: pd.DataFrame, val: dict) -> list[dict]:
    share = path(CFG["sources"]["share_csv"])
    feat = path(CFG["sources"]["features_csv"])
    imp = path(CFG["sources"]["imputed_csv"])
    out_dir = path(CFG["pipeline"]["out_dir"])
    bins_dir = path(CFG["pipeline"]["bins_dir"])
    n_bins = len(list(bins_dir.glob("*.csv"))) if bins_dir.exists() else 0
    thumbs = DATA_DIR / "thumbs"
    n_thumbs = len({p.stem.rsplit("_", 1)[0] for p in thumbs.glob("*_50.jpg")}) if thumbs.exists() else 0
    face_pp = int(s["face_happiness_avg"].notna().sum())
    rfc = path(CFG["pipeline"]["rf_comparison"])
    vfile = path(CFG["pipeline"]["validate_whole_output"])
    return [
        {"id": "authors_meta", "label": "authors' metadata", "origin": "The authors' full dataset (lab Box folder), collected with 4K Stogram and Apify; not the public OSF release.",
         "contains": "Issue, tags, account, account type, posted date, duration, views, likes, comments, aspect ratio, caption, transcript, first comment, URL.",
         "coverage": int(len(s)), "coverage_note": f"{int(s['likesCount'].isna().sum())} videos missing like counts", "file": rel(share), "last_modified": mtime(share)},
        {"id": "authors_ratings", "label": "authors' ratings", "origin": "The authors' Prolific survey of 1,007 U.S. adults, about 8 raters per video.",
         "contains": "Mean and SD of the 17 scale items, 3 dimensions and the overall sensation rating; number of raters per video.",
         "coverage": int(s["msv_m"].notna().sum()), "coverage_note": f"{int(s['n'].min())}–{int(s['n'].max())} raters per video", "file": rel(share), "last_modified": mtime(share)},
        {"id": "authors_features", "label": "authors' features", "origin": "Authors' extraction (OpenCV, librosa, Google Video Intelligence, Face++). Imputed values fill no-face and silent videos.",
         "contains": "The 11 whole-video model features; Face++ face attributes (emotions, age, gender, size).",
         "coverage": int(len(s)), "coverage_note": f"{int(s.imputed.sum())} videos with imputed cells; Face++ for {face_pp}",
         "file": f"{rel(share)} + {rel(feat)} (from {rel(imp)})", "last_modified": mtime(feat)},
        {"id": "our_features", "label": "our features", "origin": "Our re-extraction from the raw video files (pmsv_windows pipeline).",
         "contains": "9 features in 0.5 s bins (6 binned, tempo per video, shot boundaries as events), windowed conditions (k = 3, 5, 10; first 3 / 5 s; early-middle-late).",
         "coverage": n_bins, "coverage_note": "batches 7 and 8 not available locally", "file": rel(out_dir), "last_modified": mtime(out_dir / "inventory.csv")},
        {"id": "our_analysis", "label": "our analysis", "origin": "Computed by our team: precompute.py (this dashboard) and the Week 2 Random Forest comparisons.",
         "contains": "Out-of-fold predictions (10×10 CV), t-SNE / UMAP / PCA projections, k-means clusters, insight statistics, imputation flags; rf_comparison and rf_controls results.",
         "coverage": int(len(s)), "coverage_note": "Week 2 experiments cover 960 videos", "file": f"video-analysis/dashboard/backend/data/ + {rel(rfc)}", "last_modified": mtime(rfc)},
        {"id": "our_thumbnails", "label": "our thumbnails", "origin": "Frames grabbed at 25 / 50 / 75% of each local raw video by thumbs.py.",
         "contains": "Three 192 px JPEG frames per video.", "coverage": n_thumbs, "coverage_note": "only local videos (batches 1–6, 9, 10)",
         "file": "video-analysis/dashboard/backend/data/thumbs/", "last_modified": mtime(thumbs) if thumbs.exists() else None},
        {"id": "validation", "label": "validation", "origin": ("validate_whole.py output" if vfile.exists() else
                                                               "Recomputed here with the validate_whole.py method; Week 2 report values shown alongside."),
         "contains": "Agreement (Pearson r) between our whole-video features and the authors' features, per feature group.",
         "coverage": val["computed"]["n_videos"] if val["computed"] else 0, "coverage_note": "", "file": rel(path(CFG["pipeline"]["features_dir"]) / "whole.csv"),
         "last_modified": mtime(path(CFG["pipeline"]["features_dir"]) / "whole.csv")},
    ]


# ---------------------------------------------------------------- details
def details(s: pd.DataFrame, item_median: dict):
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    bins_dir = path(CFG["pipeline"]["bins_dir"])
    ev_dir = path(CFG["pipeline"]["events_dir"])
    bin_cols = CFG["columns"]["bin_features"]
    pct = {f: s[f].rank(pct=True) for f in FEATS}
    for vid, r in s.iterrows():
        d = {
            "id": vid, "items": {i: {"m": _n(r[f"{i}_m"]), "sd": _n(r[f"{i}_sd"])} for i in L.ITEM_LABELS},
            "dimensions": {k: {"m": _n(r[c]), "sd": _n(r[sd])} for k, (c, sd, _) in L.DIMENSIONS.items()},
            "caption": _s(r["caption"]), "transcript": _s(r["transcript_clean"]), "first_comment": _s(r["firstComment"]),
            "url": _s(r["url"]), "tags": r["tags"], "account": _s(r["ownerUsername"]), "posted": _s(r["posted"]),
            "views": _n(r["videoViewCount"]), "likes": _n(r["likesCount"]), "comments": _n(r["commentsCount"]),
            "face": {"n_faces_avg": _n(r["face_num_avg"]), "age_avg": _n(r["face_age_avg"]), "female_share": _n(r["face_female"]),
                     "size": _n(r["face_size"]), "emotions": {e: _n(r[f"face_{e}_avg"]) for e in L.FACE_EMOTIONS}},
            "features": {f: {"raw": _n(r[f]), "model_value": _n(r[f"{f}_imp"]), "percentile": _n(pct[f][vid]),
                             "imputed": bool(pd.isna(r[f]))} for f in FEATS},
            "bins": None, "events": None,
        }
        bp, ep = bins_dir / f"{vid}.csv", ev_dir / f"{vid}.json"
        if bp.exists():
            b = pd.read_csv(bp)
            d["bins"] = {"t_start": b["t_start"].round(3).tolist(), "t_end": b["t_end"].round(3).tolist(),
                         "features": {c: [_n(v) for v in b[c]] for c in bin_cols if c in b}}
        if ep.exists():
            e = json.loads(ep.read_text())
            d["events"] = {k: e.get(k) for k in ("duration", "fps", "has_audio", "tempo", "cuts", "beats", "bin_sec")}
            if d["bins"]:
                edges = np.array(d["bins"]["t_start"] + [d["bins"]["t_end"][-1]])
                cnt, _ = np.histogram(e.get("cuts") or [], bins=edges)
                d["bins"]["features"]["shot_changes"] = cnt.astype(int).tolist()
        (DETAILS_DIR / f"{vid}.json").write_text(json.dumps(d, allow_nan=False))


def _n(x):
    if x is None or (isinstance(x, float) and math.isnan(x)) or pd.isna(x):
        return None
    return float(x)


def _s(x):
    return None if pd.isna(x) else str(x)


# ---------------------------------------------------------------- main
def main():
    sys.stdout.reconfigure(encoding="utf-8")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    s = load()
    print(f"loaded {len(s)} videos; imputed {int(s.imputed.sum())}; local videos {int(s.has_video.sum())}; bins {int(s.has_bins.sum())}")

    X = s[[f"{f}_imp" for f in FEATS]].to_numpy()
    y = s["msv_m"].to_numpy()
    oof = oof_predictions(X, y)
    s = s.copy()
    s["pred_oof"], s["pred_oof_sd"], s["sq_err_oof"] = oof["pred"], oof["pred_sd"], oof["sq_err"]
    s["residual"] = s["pred_oof"] - s["msv_m"]
    print(f"CV MSE (mean of 100 folds) = {oof['cv_mse']:.4f}")
    assert 0.50 <= oof["cv_mse"] <= 0.54, oof["cv_mse"]

    Z = StandardScaler().fit_transform(X)
    coords, proj_params = projections(Z)
    assign, cl_tables = clusters(s, Z, coords)
    for k, t in cl_tables.items():
        print(f"k={k} silhouette={t['silhouette']:.3f} labels={[c['label'] for c in t['clusters']]}")

    exps = load_experiments()
    val = validation(s)
    ins = insights(s, exps)
    prov = provenance(s, val)

    # compact records
    recs = []
    for i, (vid, r) in enumerate(s.iterrows()):
        rec = {"id": vid, "issue": r.issue, "tags": r.tags, "account_type": r.account_type, "account": r.ownerUsername,
               "rating": float(r.msv_m), "arousal": float(r.dim_emotional_arousal_m), "dramatic": float(r.dim_dramatic_impact_m),
               "novelty": float(r.dim_novelty_m), "rater_sd": float(r.msv_sd), "n_raters": int(r.n), "ci95": float(r.ci95),
               "sd_arousal": float(r.dim_emotional_arousal_sd), "sd_dramatic": float(r.dim_dramatic_impact_sd), "sd_novelty": float(r.dim_novelty_sd),
               "pred": float(r.pred_oof), "pred_sd": float(r.pred_oof_sd), "residual": float(r.residual), "sq_err": float(r.sq_err_oof),
               "duration": float(r.videoDuration), "aspect": r.aspect, "has_speech": bool(r.has_speech), "posted": _s(r.posted),
               "no_face": bool(r.no_face), "silent": bool(r.silent), "imputed": bool(r.imputed),
               "has_bins": bool(r.has_bins), "has_video": bool(r.has_video),
               "xy": {m: [round(float(c[i, 0]), 5), round(float(c[i, 1]), 5)] for m, c in coords.items()},
               "cluster": {str(k): int(a[i]) for k, a in assign.items()},
               "attrs": {k: _n(r[k]) for k in L.NUMERIC_ATTRS if k in s.columns}}
        recs.append(rec)

    meta = {
        "n_videos": len(s), "cv_mse": oof["cv_mse"], "cv_mse_sd": oof["cv_mse_sd"], "rf_params": RF_PARAMS,
        "cv": "RepeatedKFold(n_splits=10, n_repeats=10, random_state=1)",
        "projection_params": proj_params, "clusters": cl_tables, "diffuse_threshold": DIFFUSE_SPREAD,
        "item_median": {i: float(s[f"{i}_m"].median()) for i in L.ITEM_LABELS},
        "items": L.ITEMS, "item_labels": L.ITEM_LABELS,
        "features": [{"key": f, "label": L.FEATURE_WORDS[f][0], "group": L.FEATURE_GROUP[f]} for f in L.FEATURES],
        "numeric_attrs": {k: {"label": v[0], "unit": v[1], "source": v[2]} for k, v in L.NUMERIC_ATTRS.items()},
        "issues": L.ISSUE_LABELS, "accounts": L.ACCOUNT_LABELS,
        "null_roles": {"no_face": {"n": int(s.no_face.sum()), "fields": ["faced_ps", "face_duration", "face_size"]},
                       "silent": {"n": int(s.silent.sum()), "fields": ["tempo", "loudness", "spec_centroid"]},
                       "likes_missing": {"n": int(s.likesCount.isna().sum()), "fields": ["likesCount"]},
                       "no_speech": {"n": int((~s.has_speech).sum()), "fields": ["transcript"]},
                       "face_pp_missing": {"n": int(s.face_happiness_avg.isna().sum()), "fields": ["face_*_avg", "face_age_avg", "face_female"]}},
        "validation": val, "provenance": prov,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }

    def dump(name, obj):
        (DATA_DIR / name).write_text(json.dumps(obj, default=_json_default, allow_nan=False))

    dump("videos.json", recs)
    dump("meta.json", meta)
    dump("insights.json", ins)
    dump("provenance.json", prov)
    dump("experiments.json", exps.to_dict("records") if exps is not None else [])
    # flat table for /api/compare
    cols = list({**L.NUMERIC_ATTRS}.keys()) + list(L.CATEGORICAL_ATTRS.keys())
    s[[c for c in cols if c in s.columns]].to_pickle(DATA_DIR / "compare_table.pkl")
    details(s, meta["item_median"])
    print("insights:")
    for o in ins:
        print(f"  [{o['id']}] {o['finding']} (n={o['n']})")
    print(f"wrote {DATA_DIR}")


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


if __name__ == "__main__":
    main()
