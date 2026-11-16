from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_meta_and_videos():
    m = client.get("/api/meta").json()
    assert {"clusters", "provenance", "projection_params", "cv_mse", "null_roles"} <= set(m)
    v = client.get("/api/videos").json()
    assert len(v) == 1200


def test_detail_and_bad_id():
    assert client.get("/api/videos/10_1").status_code == 200
    assert client.get("/api/videos/..%2Fsecret").status_code in (400, 404)
    assert client.get("/api/videos/7_1").json()["bins"] is None  # batch 7 not local


def test_media_404_for_missing():
    assert client.get("/media/7_1").status_code == 404


def test_thumb_bad_pos():
    assert client.get("/thumbs/10_1/40").status_code == 400


def test_compare_endpoint():
    ids = [v["id"] for v in client.get("/api/videos").json() if v["issue"] == "gmo"]
    r = client.post("/api/compare", json={"ids": ids, "baseline": "rest"}).json()
    assert r["n_a"] == 150 and r["n_b"] == 1050


def test_experiments():
    rows = client.get("/api/experiments").json()
    assert any(r["condition"] == "own_whole + len" for r in rows)
