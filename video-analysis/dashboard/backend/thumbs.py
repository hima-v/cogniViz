"""Grab frames at 25/50/75% of each local video. Resumable: existing files are skipped.

python thumbs.py [--workers 3]
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import pandas as pd

from config import CFG, THUMBS_DIR, path

POSITIONS = (25, 50, 75)
WIDTH = 192


def grab(vid: str, src: str) -> tuple[str, str | None]:
    targets = {p: THUMBS_DIR / f"{vid}_{p}.jpg" for p in POSITIONS}
    todo = [p for p, t in targets.items() if not t.exists()]
    if not todo:
        return vid, None
    cap = cv2.VideoCapture(src)
    try:
        if not cap.isOpened():
            return vid, "cannot open"
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if n <= 0:
            return vid, "no frame count"
        for p in todo:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(n - 1, int(n * p / 100))))
            ok, frame = cap.read()
            if not ok:
                return vid, f"read failed at {p}%"
            h, w = frame.shape[:2]
            frame = cv2.resize(frame, (WIDTH, round(h * WIDTH / w)), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(targets[p]), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return vid, None
    finally:
        cap.release()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    inv = pd.read_csv(path(CFG["pipeline"]["inventory"]), dtype={"video_id": str})
    failed_path = Path(__file__).parent / "thumbs_failed.csv"
    t0, done, failed = time.time(), 0, []
    with ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(grab, r.video_id, r.path) for r in inv.itertuples()]
        for f in as_completed(futs):
            vid, err = f.result()
            done += 1
            if err:
                failed.append((vid, err))
            if done % 20 == 0 or done == len(futs):
                print(f"{done}/{len(futs)} videos, {len(failed)} failed, {time.time() - t0:.0f}s", flush=True)
    with failed_path.open("w", newline="") as fh:
        csv.writer(fh).writerows([("video_id", "error"), *failed])
    print(f"done; failures in {failed_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
