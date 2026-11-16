"""Group comparison statistics for the "What's different here?" view."""
from __future__ import annotations

import numpy as np
import pandas as pd

from labels import CATEGORICAL_ATTRS, NUMERIC_ATTRS

N_BOOT = 1000
SMALL_N = 15


def hedges_g(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return float("nan")
    sp = np.sqrt(((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2))
    if sp == 0:
        return 0.0
    j = 1 - 3 / (4 * (na + nb) - 9)
    return float(j * (a.mean() - b.mean()) / sp)


def _hedges_g_rows(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """Vectorized g over bootstrap rows (each row is one resample)."""
    na, nb = A.shape[1], B.shape[1]
    sp = np.sqrt(((na - 1) * A.var(axis=1, ddof=1) + (nb - 1) * B.var(axis=1, ddof=1)) / (na + nb - 2))
    j = 1 - 3 / (4 * (na + nb) - 9)
    with np.errstate(divide="ignore", invalid="ignore"):
        g = j * (A.mean(axis=1) - B.mean(axis=1)) / sp
    return np.where(sp == 0, 0.0, g)


def hedges_g_ci(a: np.ndarray, b: np.ndarray, n_boot: int = N_BOOT, seed: int = 0) -> tuple[float, float, float]:
    g = hedges_g(a, b)
    if np.isnan(g):
        return g, float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    A = a[rng.integers(0, len(a), size=(n_boot, len(a)))]
    B = b[rng.integers(0, len(b), size=(n_boot, len(b)))]
    gs = _hedges_g_rows(A, B)
    lo, hi = np.nanpercentile(gs, [2.5, 97.5])
    return g, float(lo), float(hi)


def cliffs_delta(a: np.ndarray, b: np.ndarray) -> float:
    a, b = np.asarray(a), np.sort(np.asarray(b))
    gt = np.searchsorted(b, a, side="left").sum()
    lt = (len(b) - np.searchsorted(b, a, side="right")).sum()
    return float((gt - lt) / (len(a) * len(b)))


def compare_groups(df: pd.DataFrame, ids_a: list[str], ids_b: list[str]) -> dict:
    """Rank attribute differences between group A and group B (both are lists of video ids)."""
    a = df.loc[df.index.intersection(ids_a)]
    b = df.loc[df.index.intersection(ids_b)]
    small = len(a) < SMALL_N or len(b) < SMALL_N
    numeric = []
    for key, (label, unit, source) in NUMERIC_ATTRS.items():
        if key not in df:
            continue
        va, vb = a[key].to_numpy(float), b[key].to_numpy(float)
        ma, mb = ~np.isnan(va), ~np.isnan(vb)
        va, vb = va[ma], vb[mb]
        g, lo, hi = hedges_g_ci(va, vb) if len(va) >= 2 and len(vb) >= 2 else (float("nan"),) * 3
        col = df[key].dropna()
        numeric.append({
            "key": key, "label": label, "unit": unit, "source": source,
            "g": _f(g), "g_lo": _f(lo), "g_hi": _f(hi),
            "mean_a": _f(va.mean()) if len(va) else None, "mean_b": _f(vb.mean()) if len(vb) else None,
            "n_a": int(len(va)), "n_b": int(len(vb)),
            "missing_a": int((~ma).sum()), "missing_b": int((~mb).sum()),
            "scale_min": _f(col.quantile(0.01)), "scale_max": _f(col.quantile(0.99)),
        })
    numeric.sort(key=lambda r: -abs(r["g"]) if r["g"] is not None else 0)

    categorical = []
    for key, (label, source) in CATEGORICAL_ATTRS.items():
        ca = a[key].astype(str).value_counts(normalize=True)
        cb = b[key].astype(str).value_counts(normalize=True)
        cats = sorted(set(ca.index) | set(cb.index))
        rows = [{"category": c, "share_a": float(ca.get(c, 0)), "share_b": float(cb.get(c, 0)),
                 "diff_pp": float(100 * (ca.get(c, 0) - cb.get(c, 0)))} for c in cats]
        rows.sort(key=lambda r: -abs(r["diff_pp"]))
        categorical.append({"key": key, "label": label, "source": source, "categories": rows,
                            "top": rows[0] if rows else None,
                            "max_abs_pp": abs(rows[0]["diff_pp"]) if rows else 0.0})
    categorical.sort(key=lambda r: -r["max_abs_pp"])
    return {"n_a": int(len(a)), "n_b": int(len(b)), "small_group": small,
            "numeric": numeric, "categorical": categorical}


def _f(x) -> float | None:
    x = float(x)
    return None if np.isnan(x) else x
