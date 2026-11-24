"""Dashboard API. Run: uvicorn app:app --port 8000 (from backend/)."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from config import CFG, DATA_DIR, DETAILS_DIR, THUMBS_DIR
from stats import compare_groups

app = FastAPI(title="PMSV explorer API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

ID_RE = re.compile(r"^\d+_\d+$")


def _load(name: str, default=None):
    p = DATA_DIR / name
    if not p.exists():
        if default is not None:
            return default
        raise HTTPException(503, f"{name} missing: run precompute.py")
    return json.loads(p.read_text(encoding="utf-8"))


@lru_cache
def compare_table() -> pd.DataFrame:
    return pd.read_pickle(DATA_DIR / "compare_table.pkl")


@lru_cache
def _video_paths_from_inventory() -> dict[str, str]:
    from config import path

    inv = path(CFG["pipeline"]["inventory"])
    if not inv.exists():
        return {}
    d = pd.read_csv(inv, dtype={"video_id": str})
    return dict(zip(d["video_id"], d["path"]))


def _check_id(vid: str) -> str:
    if not ID_RE.match(vid):
        raise HTTPException(400, "bad id")
    return vid


@app.get("/api/meta")
def meta():
    m = _load("meta.json")
    # coverage of thumbnails grows while thumbs.py runs; refresh it on each call
    n_thumbs = len(list(THUMBS_DIR.glob("*_50.jpg"))) if THUMBS_DIR.exists() else 0
    for p in m["provenance"]:
        if p["id"] == "our_thumbnails":
            p["coverage"] = n_thumbs
    return m


@app.get("/api/videos")
def videos():
    return _load("videos.json")


@app.get("/api/videos/{vid}")
def video(vid: str):
    p = DETAILS_DIR / f"{_check_id(vid)}.json"
    if not p.exists():
        raise HTTPException(404, "no detail file")
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/api/insights")
def insights():
    return _load("insights.json")


@app.get("/api/experiments")
def experiments():
    return _load("experiments.json", default=[])


class CompareBody(BaseModel):
    ids: list[str]
    baseline: str | None = "rest"
    ids2: list[str] | None = None
    pool: list[str] | None = None  # the filtered set; "rest" = pool minus ids


@app.post("/api/compare")
def compare(body: CompareBody):
    t = compare_table()
    if body.ids2:
        b = body.ids2
    else:
        pool = set(body.pool) if body.pool else set(t.index)
        b = sorted(pool - set(body.ids))
    return compare_groups(t, body.ids, b)


@app.get("/media/{vid}")
def media(vid: str, request: Request):
    p = _video_paths_from_inventory().get(_check_id(vid))
    if not p or not Path(p).exists():
        raise HTTPException(404, "video not local")
    size = Path(p).stat().st_size
    rng = request.headers.get("range")
    if not rng:
        return FileResponse(
            p, media_type="video/mp4", headers={"Accept-Ranges": "bytes"}
        )
    m = re.match(r"bytes=(\d*)-(\d*)", rng)
    if not m:
        raise HTTPException(416)
    start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
    end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
    end = min(
        end, size - 1, start + 2 * 1024 * 1024 - 1
    )  # serve at most 2 MB per request
    if start > end:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})

    def chunks():
        with open(p, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                buf = f.read(min(65536, left))
                if not buf:
                    break
                left -= len(buf)
                yield buf

    return StreamingResponse(
        chunks(),
        status_code=206,
        media_type="video/mp4",
        headers={
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
        },
    )


@app.get("/thumbs/{vid}/{pos}")
def thumb(vid: str, pos: int):
    if pos not in (25, 50, 75):
        raise HTTPException(400, "pos must be 25, 50 or 75")
    p = THUMBS_DIR / f"{_check_id(vid)}_{pos}.jpg"
    if not p.exists():
        raise HTTPException(404, "no thumbnail")
    return FileResponse(
        p, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"}
    )
