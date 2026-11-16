"""Re-assert the verified dataset facts and the precompute outputs."""
import json

import numpy as np
import pandas as pd
import pytest

from config import CFG, DATA_DIR, DETAILS_DIR, path


@pytest.fixture(scope="module")
def share():
    return pd.read_csv(path(CFG["sources"]["share_csv"]), dtype={"survey_batch_id": str})


@pytest.fixture(scope="module")
def videos():
    return json.loads((DATA_DIR / "videos.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def meta():
    return json.loads((DATA_DIR / "meta.json").read_text(encoding="utf-8"))


def test_key_is_survey_batch_id(share):
    assert share["survey_batch_id"].is_unique and len(share) == 1200
    # trap: video_id is the index within a batch and must never be used as a key
    assert share["video_id"].nunique() == 120


def test_issue_balance(share):
    vc = share["sampled_cat"].value_counts()
    assert len(vc) == 8 and (vc == 150).all()


def test_account_types(share):
    assert share["type"].value_counts().to_dict() == {"popular": 800, "unpopular": 400}
    assert share["ownerUsername"].nunique() == 153


def test_missingness_is_structural(share):
    no_face = share["face_count"] == 0
    assert no_face.sum() == 222
    assert (share["faced_ps"].isna() == no_face).all()
    assert (share["face_duration"].isna() == no_face).all()
    silent = share["tempo"].isna()
    assert silent.sum() == 45
    assert (share[["loudness", "spec_centroid"]].isna().all(axis=1) == silent).all()
    assert share["likesCount"].isna().sum() == 8


def test_outputs_complete(videos, meta):
    assert len(videos) == 1200 and len({v["id"] for v in videos}) == 1200
    assert 0.50 <= meta["cv_mse"] <= 0.54
    for v in videos:
        for m, xy in v["xy"].items():
            assert all(np.isfinite(xy)), (v["id"], m)
    assert sum(v["imputed"] for v in videos) == 242
    assert sum(v["no_face"] for v in videos) == 222
    assert sum(v["silent"] for v in videos) == 45


def test_predictions_are_out_of_fold(videos, meta):
    # In-sample RF predictions on this data have MSE far below 0.4; OOF must be near the CV MSE.
    y = np.array([v["rating"] for v in videos])
    sq = np.array([v["sq_err"] for v in videos])
    assert abs(sq.mean() - meta["cv_mse"]) < 0.01
    res = np.array([v["residual"] for v in videos])
    pred = np.array([v["pred"] for v in videos])
    assert np.allclose(res, pred - y)


def test_cluster_labels_are_feature_only(meta):
    banned = ["climate", "covid", "vaccine", "gmo", "election", "health", "russia", "ukraine", "medicine",
              "rating", "rated", "sensation", "popular"]
    for k, t in meta["clusters"].items():
        labels = [c["label"] for c in t["clusters"]]
        assert len(set(labels)) == len(labels), f"duplicate labels at k={k}"
        for lab in labels:
            assert not any(b in lab.lower() for b in banned), lab


def test_insights_computed(meta):
    ins = json.loads((DATA_DIR / "insights.json").read_text(encoding="utf-8"))
    ids = {i["id"] for i in ins}
    assert {"issue_gap", "account_type", "length", "faces", "editing", "dimensions", "disagreement",
            "engagement", "temporal", "data_quality"} <= ids
    for i in ins:
        assert i["n"] >= 0 and i["caveat"].startswith("Association, not cause") and i["sources"]
    faces = next(i for i in ins if i["id"] == "faces")
    assert faces["n"] == 978 and -0.5 < faces["stats"]["rho"] < -0.35


def test_provenance(meta):
    ids = {p["id"] for p in meta["provenance"]}
    assert ids == {"authors_meta", "authors_ratings", "authors_features", "our_features", "our_analysis",
                   "our_thumbnails", "validation"}
    our = next(p for p in meta["provenance"] if p["id"] == "our_features")
    assert our["coverage"] == 960


def test_details_written(videos):
    assert len(list(DETAILS_DIR.glob("*.json"))) == 1200
    d = json.loads((DETAILS_DIR / "10_1.json").read_text(encoding="utf-8"))
    assert len(d["items"]) == 17 and d["bins"] is not None and "shot_changes" in d["bins"]["features"]


def _reject_constant(name):
    raise ValueError(f"non-JSON constant {name}")


def test_all_json_is_strict():
    # NaN/Infinity would make the API fail to encode the response
    files = list(DETAILS_DIR.glob("*.json")) + list(DATA_DIR.glob("*.json"))
    for p in files:
        json.loads(p.read_text(encoding="utf-8"), parse_constant=_reject_constant)
