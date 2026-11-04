# PMSV temporal windows: Random Forest comparison

Run everything from a local folder (e.g. `C:\dev\video-analysis\pmsv_windows`).
Videos are read from Box Drive; all outputs go to `out\` on your local disk.

    pip install -r requirements.txt

| Step | Script | Output |
|---|---|---|
| 0 | `prepare_dataset.py` | `data/pmsv_dataset.csv` (adds video_id = survey_batch_id, duration) |
| 1 | `check_inventory.py` | `out/inventory.csv`, `out/missing_ids.csv` |
| 2 | `extract_features.py` | `out/bins/<id>.csv`, `out/events/<id>.json` |
| 3 | `build_windows.py` | `out/features/<condition>.csv`, `meta.csv` |
| 4 | `validate_whole.py` | agreement with the paper's features and durations |
| 5 | `compare_rf.py` | `out/rf_comparison.csv` |

Run ONE command at a time from `C:\dev\video-analysis\pmsv_windows` and check its output first.

```
python prepare_dataset.py --imputed "C:\dev\msv-rf-repro\data\msv_df_imputed.csv" --share "C:\dev\video-analysis\data\msv_df_share.csv" --out "C:\dev\video-analysis\data\pmsv_dataset.csv"
python check_inventory.py --videos "C:\Users\hima2\Box\Video Data Analytics Reels Data" --csv "C:\dev\video-analysis\data\pmsv_dataset.csv"
python extract_features.py --inventory out\inventory.csv --limit 10
python extract_features.py --inventory out\inventory.csv --workers 3
python build_windows.py
python validate_whole.py --csv "C:\dev\video-analysis\data\pmsv_dataset.csv"
python compare_rf.py --csv "C:\dev\video-analysis\data\pmsv_dataset.csv"
```

Decisions to confirm (and report in the write-up)
- IDs: `video_id` = `survey_batch_id` from msv_df_share.csv (e.g. `2_1`), matching the filename part before `+`.
- Visual features follow the paper's released code: brightness = LAB L, saturation = HLS S, warmness = HSV inRange [0,50,50]-[30,255,255].
- `--every-n`: frame sampling. The paper text says 1 in 6, the released code uses 1 in 30.
- Faces are not extracted yet, so own features have 9 columns, not 11. `paper_9` is the matching baseline.
- `shotd_ps` per window = mean shot-piece length / window length. Check against notebook 1.2.
- Windowed tempo = 0 when a window has fewer than 3 beats (common for short windows).
- Silent videos get loudness and spectral centroid = 0, not imputed values.
