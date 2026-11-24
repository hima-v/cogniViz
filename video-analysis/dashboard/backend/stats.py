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


def _boot_weights(n: int, n_boot: int, rng: np.random.Generator) -> np.ndarray:
    """Resample counts: row r says how often each observation appears in bootstrap sample r."""
    idx = rng.integers(0, n, size=(n_boot, n))
    flat = (idx + (np.arange(n_boot) * n)[:, None]).ravel()
    return np.bincount(flat, minlength=n_boot * n).reshape(n_boot, n).astype(np.float64)


def _boot_mean_var(x: np.ndarray, w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n = len(x)
    m = w @ x / n
    m2 = w @ (x * x) / n
    var = np.maximum(m2 - m * m, 0.0) * n / (n - 1)
    return m, var


def _weights(na: int, nb: int, n_boot: int, seed: int, cache: dict | None):
    key = (na, nb, n_boot, seed)
    if cache is not None and key in cache:
        return cache[key]
    rng = np.random.default_rng(seed)
    w = (_boot_weights(na, n_boot, rng), _boot_weights(nb, n_boot, rng))
    if cache is not None:
        cache[key] = w
    return w


def hedges_g_ci(a: np.ndarray, b: np.ndarray, n_boot: int = N_BOOT, seed: int = 0, cache: dict | None = None) -> tuple[float, float, float]:
    g = hedges_g(a, b)
    if np.isnan(g):
        return g, float("nan"), float("nan")
    # Same seed => same resamples for every attribute with the same group sizes; the cache only skips regenerating them.
    wa, wb = _weights(len(a), len(b), n_boot, seed, cache)
    ma, va = _boot_mean_var(a, wa)
    mb, vb = _boot_mean_var(b, wb)
    na, nb = len(a), len(b)
    sp = np.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2))
    j = 1 - 3 / (4 * (na + nb) - 9)
    with np.errstate(divide="ignore", invalid="ignore"):
        gs = np.where(sp == 0, 0.0, j * (ma - mb) / sp)
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
    cache: dict = {}
    for key, (label, unit, source) in NUMERIC_ATTRS.items():
        if key not in df:
            continue
        va, vb = a[key].to_numpy(float), b[key].to_numpy(float)
        ma, mb = ~np.isnan(va), ~np.isnan(vb)
        va, vb = va[ma], vb[mb]
        g, lo, hi = hedges_g_ci(va, vb, cache=cache) if len(va) >= 2 and len(vb) >= 2 else (float("nan"),) * 3
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
