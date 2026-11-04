"""Step 2: extract features once, in short time bins, for every video.

For each video it writes
  out/bins/<video_id>.csv    one row per time bin (default 0.5 s): visual + audio features
  out/events/<video_id>.json duration, fps, has_audio, shot cut times, beat times, whole-video tempo
Videos that already have both files are skipped, so you can stop and restart at any time.

Visual feature definitions follow the paper's released code (Test notebook, cell 8):
  brightness  mean L of OpenCV LAB, 0-255     saturation  mean S of OpenCV HLS, 0-255
  warmness    share of pixels in HSV range [0,50,50]-[30,255,255]
  entropy     Shannon entropy of the grayscale histogram, 0-8
  loudness    librosa RMS (waveform in -1..1)    spec_centroid  librosa spectral centroid, Hz
Faces are not extracted here (see README).

Usage:
  python extract_features.py --inventory out/inventory.csv --out out --workers 2
"""
import argparse, json, shutil, subprocess, tempfile, traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

SR = 22050
HOP = 512


def visual_bins(path, bin_sec, every_n):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError("OpenCV could not open video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    rows, idx = [], 0
    while True:
        if idx % every_n == 0:
            ok, frame = cap.read()
            if not ok:
                break
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
            hls = cv2.cvtColor(frame, cv2.COLOR_BGR2HLS)
            warm = cv2.inRange(hsv, (0, 50, 50), (30, 255, 255))
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            p = np.bincount(gray.ravel(), minlength=256) / gray.size
            p = p[p > 0]
            rows.append({"t": idx / fps,
                         "brightness": lab[..., 0].mean(),
                         "saturation": hls[..., 2].mean(),
                         "warmness": np.count_nonzero(warm) / warm.size,
                         "entropy": float(-(p * np.log2(p)).sum())})
        elif not cap.grab():
            break
        idx += 1
    cap.release()
    duration = idx / fps
    v = pd.DataFrame(rows)
    v["bin"] = (v.t // bin_sec).astype(int)
    return v.drop(columns="t").groupby("bin").mean(), duration, fps


def load_audio(path):
    import imageio_ffmpeg
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path),
           "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32) if r.stdout else np.zeros(0, np.float32)


def audio_bins(y, bin_sec):
    import librosa
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    cen = librosa.feature.spectral_centroid(y=y, sr=SR, hop_length=HOP)[0]
    t = librosa.frames_to_time(np.arange(len(rms)), sr=SR, hop_length=HOP)
    a = pd.DataFrame({"loudness": rms, "spec_centroid": cen, "bin": (t // bin_sec).astype(int)})
    return a.groupby("bin").mean()


def make_detector(name, threshold):
    from scenedetect import ContentDetector, AdaptiveDetector
    if name == "adaptive":
        return AdaptiveDetector(adaptive_threshold=threshold)
    return ContentDetector(threshold=threshold)


def shot_cuts(path, detector="content", threshold=27.0):
    from scenedetect import detect
    scenes = detect(str(path), make_detector(detector, threshold), show_progress=False)
    def sec(tc):  # `.seconds` in newer PySceneDetect, get_seconds() in older versions
        return tc.seconds if hasattr(type(tc), "seconds") else tc.get_seconds()
    return [round(sec(s[0]), 3) for s in scenes[1:]]  # start of every shot after the first


def process(video_id, src, out, bin_sec, every_n, copy_local, detector="content", threshold=27.0):
    bins_f, ev_f = out / "bins" / f"{video_id}.csv", out / "events" / f"{video_id}.json"
    if bins_f.exists() and ev_f.exists():
        return video_id, "skipped"
    tmpdir = None
    try:
        path = Path(src)
        if copy_local:  # one read from Box, then all decoding happens on a local copy
            tmpdir = Path(tempfile.mkdtemp(prefix="pmsv_"))
            path = Path(shutil.copyfile(src, tmpdir / f"{video_id}{Path(src).suffix}"))  # content only; Box placeholders download here

        vis, duration, fps = visual_bins(path, bin_sec, every_n)

        y = load_audio(path)
        has_audio = bool(y.size) and float(np.abs(y).max()) > 1e-4
        if has_audio:
            import librosa
            aud = audio_bins(y, bin_sec)
            tempo, beats = librosa.beat.beat_track(y=y, sr=SR, units="time")
            tempo, beats = float(np.atleast_1d(tempo)[0]), [round(float(b), 3) for b in beats]
        else:  # silent or no audio track: real zeros, not imputed values
            aud = pd.DataFrame(0.0, index=vis.index, columns=["loudness", "spec_centroid"])
            tempo, beats = 0.0, []

        df = vis.join(aud, how="left").fillna({"loudness": 0.0, "spec_centroid": 0.0})
        df.index.name = "bin"
        df.insert(0, "t_start", df.index * bin_sec)
        df.insert(1, "t_end", np.minimum((df.index + 1) * bin_sec, duration))
        df = df[df.t_end > df.t_start]

        events = {"video_id": video_id, "duration": duration, "fps": fps,
                  "has_audio": has_audio, "tempo": tempo, "beats": beats,
                  "cuts": shot_cuts(path, detector, threshold), "shot_detector": f"{detector}:{threshold}",
                  "bin_sec": bin_sec, "every_n": every_n}

        bins_f.parent.mkdir(parents=True, exist_ok=True)
        ev_f.parent.mkdir(parents=True, exist_ok=True)
        df.reset_index().to_csv(bins_f, index=False)
        ev_f.write_text(json.dumps(events))  # written last: marks the video as done
        return video_id, "ok"
    except Exception:
        return video_id, "ERROR\n" + traceback.format_exc()
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", required=True, type=Path)
    ap.add_argument("--out", default="out", type=Path)
    ap.add_argument("--bin-sec", default=0.5, type=float)
    ap.add_argument("--every-n", default=6, type=int, help="sample 1 frame in N (paper text says 6, its code 30)")
    ap.add_argument("--workers", default=2, type=int)
    ap.add_argument("--detector", default="content", choices=["content", "adaptive"])
    ap.add_argument("--threshold", default=27.0, type=float, help="PySceneDetect threshold (pick with tune_shots.py)")
    ap.add_argument("--limit", default=0, type=int, help="process only the first N videos (testing)")
    ap.add_argument("--no-copy", action="store_true", help="read directly from Box instead of a local temp copy")
    a = ap.parse_args()

    inv = pd.read_csv(a.inventory, dtype={"video_id": str})
    inv = inv[inv.in_dataset].drop_duplicates("video_id")
    if a.limit:
        inv = inv.head(a.limit)
    a.out.mkdir(parents=True, exist_ok=True)
    log = open(a.out / "extract_errors.log", "a", encoding="utf-8")

    from tqdm import tqdm
    n_err = 0
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(process, r.video_id, r.path, a.out, a.bin_sec, a.every_n, not a.no_copy,
                          a.detector, a.threshold)
                for r in inv.itertuples()]
        for f in tqdm(as_completed(futs), total=len(futs)):
            vid, status = f.result()
            if status.startswith("ERROR"):
                n_err += 1
                log.write(f"{vid}: {status}\n")
                log.flush()
    print(f"done. errors: {n_err} (see {a.out/'extract_errors.log'})")


if __name__ == "__main__":  # required on Windows for multiprocessing
    main()
