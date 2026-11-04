"""Step 0: build one dataset file with a real video ID.

msv_df_imputed.csv (features + perceived_msv) has no ID column, but its rows are in the
same order as msv_df_share.csv. This script checks that, then writes pmsv_dataset.csv with
  video_id   = survey_batch_id (e.g. "2_1"), the part of the filename before "+"
  post_id    = Instagram id (the part between "+" and "_")
  duration   = videoDuration (seconds)
  perceived_msv + the paper's 11 features (imputed values, as used by the paper)

Usage:
  python prepare_dataset.py --imputed C:\\dev\\msv-rf-repro\\data\\msv_df_imputed.csv ^
                            --share   C:\\dev\\video-analysis\\data\\msv_df_share.csv ^
                            --out     C:\\dev\\video-analysis\\data\\pmsv_dataset.csv
"""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from common import PAPER_F11

ap = argparse.ArgumentParser()
ap.add_argument("--imputed", required=True, type=Path)
ap.add_argument("--share", required=True, type=Path)
ap.add_argument("--out", required=True, type=Path)
a = ap.parse_args()

imp = pd.read_csv(a.imputed)
sh = pd.read_csv(a.share, dtype={"survey_batch_id": str, "id": str, "ownerId": str})
assert len(imp) == len(sh), f"row counts differ: {len(imp)} vs {len(sh)}"

# 1. Row alignment, using features that were never imputed
for c in ["brightness", "saturation", "warmness", "entropy", "shotc_ps", "shotd_ps"]:
    ok = np.isclose(imp[c].to_numpy(float), sh[c].to_numpy(float), equal_nan=True).mean()
    print(f"aligned {c:12s} {ok:7.2%}")
    assert ok == 1.0, f"rows are NOT aligned on {c}; stop and investigate"

# 2. Is the rating the same as msv_m?
d = np.abs(imp["perceived_msv"].to_numpy(float) - sh["msv_m"].to_numpy(float))
print(f"perceived_msv vs msv_m: max abs diff {np.nanmax(d):.6f}")

# 3. How the paper's per-second shot/face features relate to the raw columns
dur = sh["videoDuration"].astype(float)
for ps, raw in [("shotc_ps", "shot_count"), ("shotd_ps", "shot_duration"),
                ("facec_ps", "face_count"), ("faced_ps", "face_duration")]:
    if raw in sh:
        ratio = sh[ps] / (sh[raw] / dur)
        print(f"{ps:9s} / ({raw}/videoDuration): median {ratio.median():.4f}  "
              f"r(raw, ps)={sh[raw].corr(sh[ps]):.3f}   {raw} example {sh[raw].head(3).round(3).tolist()}")

# 4. Which features differ between share (raw) and imputed (= imputed values)
changed = {c: int((~np.isclose(imp[c], sh[c], equal_nan=False)).sum()) for c in PAPER_F11}
print("rows changed by imputation:", {k: v for k, v in changed.items() if v})

out = pd.DataFrame({"video_id": sh["survey_batch_id"].str.strip(),
                    "post_id": sh["id"].str.strip(),
                    "duration": dur,
                    "perceived_msv": imp["perceived_msv"]})
out = pd.concat([out, imp[PAPER_F11]], axis=1)
assert out.video_id.is_unique, "survey_batch_id is not unique"
a.out.parent.mkdir(parents=True, exist_ok=True)
out.to_csv(a.out, index=False)
print(f"\nwrote {a.out}  ({len(out)} rows, ids like {out.video_id.head(3).tolist()})")
