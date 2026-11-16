import numpy as np
import pandas as pd
import pytest

from config import DATA_DIR
from stats import cliffs_delta, compare_groups, hedges_g, hedges_g_ci


def test_hedges_g_known_value():
    a = np.array([2.0, 4.0, 6.0, 8.0])
    b = np.array([1.0, 3.0, 5.0, 7.0])
    # d = 1 / sd(=2.582) = 0.3873; J = 1 - 3/(4*8-9) = 0.8696
    assert hedges_g(a, b) == pytest.approx(0.3873 * (1 - 3 / 23), abs=1e-3)
    assert hedges_g(b, a) == pytest.approx(-hedges_g(a, b))


def test_hedges_ci_brackets_and_is_deterministic():
    rng = np.random.default_rng(1)
    a, b = rng.normal(1, 1, 60), rng.normal(0, 1, 80)
    g1, lo1, hi1 = hedges_g_ci(a, b)
    g2, lo2, hi2 = hedges_g_ci(a, b)
    assert lo1 < g1 < hi1 and (g1, lo1, hi1) == (g2, lo2, hi2)
    assert lo1 > 0


def test_cliffs_delta():
    assert cliffs_delta(np.array([3, 4]), np.array([1, 2])) == 1.0
    assert cliffs_delta(np.array([1, 2]), np.array([1, 2])) == 0.0


@pytest.fixture(scope="module")
def table():
    return pd.read_pickle(DATA_DIR / "compare_table.pkl")


def test_compare_fixed_selection(table):
    climate = table.index[table["issue"] == "climate_change"].tolist()
    rest = table.index.difference(climate).tolist()
    r = compare_groups(table, climate, rest)
    assert r["n_a"] == 150 and r["n_b"] == 1050 and not r["small_group"]
    issue = next(c for c in r["categorical"] if c["key"] == "issue")
    assert issue["top"]["category"] == "climate_change" and issue["top"]["diff_pp"] == pytest.approx(100.0)
    rating = next(n for n in r["numeric"] if n["key"] == "msv_m")
    assert rating["g"] > 0 and rating["g_lo"] < rating["g"] < rating["g_hi"]
    # imputed cells excluded and counted
    face = next(n for n in r["numeric"] if n["key"] == "faced_ps")
    assert face["missing_a"] + face["missing_b"] == 222
    gs = [abs(n["g"]) for n in r["numeric"] if n["g"] is not None]
    assert gs == sorted(gs, reverse=True)


def test_small_group_flag(table):
    r = compare_groups(table, table.index[:10].tolist(), table.index[10:].tolist())
    assert r["small_group"]
