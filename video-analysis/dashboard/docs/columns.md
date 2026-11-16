# Pipeline output schemas (inspected in M0)

All under `C:\dev\video-analysis\pmsv_windows\out\`. Key is `video_id`, which equals the share CSV's `survey_batch_id` (e.g. `"10_1"`).

## inventory.csv (960 x 4)
| column | dtype | notes |
|---|---|---|
| path | str | absolute mp4 path in the Box folder |
| video_id | str | = survey_batch_id |
| batch | str | e.g. `batch 1` |
| in_dataset | bool | |

Batches 7 and 8 are not local; `missing_ids.csv` (240 x 1, `video_id`) lists them.

## bins/&lt;id&gt;.csv (960 files)
| column | dtype | notes |
|---|---|---|
| bin | int | bin index |
| t_start, t_end | float | seconds, 0.5 s bins |
| brightness, saturation, warmness, entropy | float | visual |
| loudness, spec_centroid | float | audio |

**Differs from HANDOFF:** only 6 of the 9 features are binned. Tempo is a single value per video (events json),
and shot count / shot duration are not binned. The dashboard derives shot changes per bin from `events.cuts`.

## events/&lt;id&gt;.json (960 files)
`{video_id, duration, fps, has_audio, tempo, beats: [s...], cuts: [s...], shot_detector, bin_sec, every_n}`.
Confirmed: `cuts` are shot boundaries in seconds; `beats` are audio beat times.

## features/&lt;condition&gt;.csv (960 rows each)
| file | columns |
|---|---|
| whole.csv | video_id + 9 features (brightness, saturation, warmness, entropy, loudness, spec_centroid, shotc_ps, shotd_ps, tempo) |
| first3.csv, first5.csv | same 9, first 3 s / 5 s only |
| k3, k5, k10.csv | 9 features x k windows, suffix `_w1.._wk` |
| eml.csv | 9 features x {early, middle, late} |
| meta.csv | video_id, duration (float), log_length (float), has_audio (bool), n_cuts (int) |

## rf_comparison.csv (10 x 6)
`condition (str), n_features (int), cv_mse (float), sd_across_repeats (float), diff_vs_own_whole (float), folds_better_than_own_whole (float)`.
Conditions: paper_11, paper_9, own_whole, own_whole + log_length, own_k3/k5/k10, own_first3/first5, own_eml.

## rf_controls*.csv (13 x 6 each)
`condition (str), n_features (str, e.g. "3x10"), cv_mse, sd_across_repeats, diff_vs_whole_len, folds_better`.
Conditions per k in {3,5,10}: concat, shuffled, summary, late_fusion (all + len), plus `own_whole + len`.
Files: `rf_controls.csv`, `rf_controls_seed1.csv`, `rf_controls_seed2.csv`.
**Surprise:** `rf_controls_seed2.csv` is byte-for-byte identical in values to `rf_controls.csv`; the dashboard de-duplicates identical runs rather than counting them as separate seeds.

## validate_whole.py
Prints to stdout only; no saved output file. The dashboard recomputes the same per-feature Pearson r
(our `whole.csv` vs the authors' features) in precompute and also shows the Week 2 documented values.

## Other
- `tune_shots.csv` (20 x 8): shot-detector tuning; not used.
- `extract_errors.log`: empty.

## Inputs
- `data/msv_df_share.csv`: 1,200 x 104 (see HANDOFF 4.1).
- `data/pmsv_dataset.csv`: 1,200 x 15: video_id, post_id, duration, perceived_msv, and the 11 imputed features.
- `msv-rf-repro/data/msv_df_imputed.csv`: 1,200 x 12, the 11 features + perceived_msv, **no id column** (row order only); not used for the join, `pmsv_dataset.csv` is.
