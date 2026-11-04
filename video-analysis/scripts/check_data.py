import sys, glob, os
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent  # C:\dev\video-analysis
s = pd.read_csv(ROOT / "data" / "msv_df_share.csv")
o = pd.read_csv(ROOT / "data" / "msv_df.csv")

print("share file:", s.shape, "| sampled:", s.sampled.value_counts().to_dict())
print(
    "per batch:",
    s.video_id.str.split("_").str[0].astype(int).value_counts().sort_index().to_dict(),
)
print("IDs match OSF:", set(s.video_id) == set(o.video_id))

m = s.merge(o[["video_id", "perceived_msv"]], on="video_id")
print("max |msv_m - perceived_msv|:", round((m.msv_m - m.perceived_msv).abs().max(), 4))

nf = s.face_count.eq(0)
print(
    "no-face videos:",
    nf.sum(),
    "| face_duration NaN:",
    s.loc[nf, "face_duration"].isna().sum(),
    "| equal to 0:",
    s.loc[nf, "face_duration"].eq(0).sum(),
)
print("no-audio videos (tempo NaN):", s.tempo.isna().sum())

# videos on disk (pass folder path as arg, default data/videos)
vdir = (
    sys.argv[1]
    if len(sys.argv) > 1
    else r"C:\Users\hima2\Box\Video Data Analytics Reels Data"
)
files = glob.glob(os.path.join(vdir, "**", "*.mp4"), recursive=True)
ids = {os.path.basename(f).split("+")[0] for f in files}
print(f"\nvideos on disk: {len(files)} | matched to CSV: {len(ids & set(s.video_id))}")
print("example unmatched:", sorted(ids - set(s.video_id))[:5])
