# PMSV explorer (v0.1)

A linked-view dashboard for exploring how perceived message sensation value (PMSV) ratings of 1,200 Instagram Reels vary with their
metadata, audio-visual features and model error, with our team's findings as guided entry points.

## Run it

All commands assume the shared environment at `C:\dev\.venv` and Node 18 or newer.

```powershell
# 1. Backend dependencies (once)
C:\dev\.venv\Scripts\python.exe -m pip install fastapi "uvicorn[standard]" pandas numpy scikit-learn umap-learn scipy pyyaml opencv-python-headless pytest httpx

# 2. Precompute (about 2 minutes): predictions, projections, clusters, insights, provenance, detail files
cd C:\dev\video-analysis\dashboard\backend
C:\dev\.venv\Scripts\python.exe precompute.py

# 3. Thumbnails (slow, resumable; reads videos from the Box folder)
C:\dev\.venv\Scripts\python.exe thumbs.py --workers 3

# 4. Tests
C:\dev\.venv\Scripts\python.exe -m pytest -q

# 5. API on port 8000
C:\dev\.venv\Scripts\python.exe -m uvicorn app:app --port 8000

# 6. Frontend on port 5173 (second terminal)
cd C:\dev\video-analysis\dashboard\frontend
npm install
npm run dev
```

Open http://localhost:5173. The frontend expects the API at `http://127.0.0.1:8000`; set `VITE_API` to change it.

Paths live in `backend/config.yaml`. Generated files go to `backend/data/` (gitignored). Nothing under `data/`, `pmsv_windows/` or the Box
folder is written.

## Layout

| View | What it shows | Sources |
|---|---|---|
| Findings (V0) | Insight cards; numbers computed in `precompute.py`; "Show in views" loads a dashboard state | per card |
| Map (V1) | t-SNE / UMAP / PCA of the 11 standardized features, density contours, cluster labels, lasso | authors' features, our projection |
| Predictions (V2) | Out-of-fold (10×10 CV) predicted vs actual, CI bars, rectangle brush | authors' ratings, our predictions |
| Cluster patterns (V4) | k-means profiles (k = 4–8), feature glyphs, rating CI, MSE, issue mix | our clusters on authors' features |
| Samples (V8) | Thumbnails of the selection, lazily loaded | our thumbnails, authors' ratings |
| What's different here? (V7) | Selection vs rest (or pinned A vs B): Hedges' g with bootstrap CIs, category share differences | per row |
| Attributes (V3) | Rating by issue and account type; rating vs any attribute with binned means and Spearman ρ | authors' ratings + metadata/features |
| Experiments (V6) | Week 2 Random Forest comparisons and controls | our experiments (960 videos) |
| Video detail (V5) | Player, ratings with CI, 17 items, feature percentiles, 0.5 s timeline synced to playback, text | per section |

Selection, hover, focus, filters and colors are shared across all views. Esc clears the selection. "Data sources" in the header (or any gray
source line) explains where every number comes from.

## Data notes

- Join key is `survey_batch_id`. The share CSV's `video_id` is an index within a batch and is never used.
- 222 videos have no detected faces and 45 have no audio (25 both, so 242 videos in total). Their face-time / audio values are imputed in the
  model input. They are flagged everywhere, left out of attribute plots and comparisons, and can be hidden.
- Predictions are out-of-fold only: `RepeatedKFold(10, 10, random_state=1)`, mean of the 10 repeats per video.
- Column notes for the pipeline outputs are in `docs/columns.md`.

## Planned for v0.2

Robustness checks on insight cards, an analysis trail with revert and Markdown export (the reducer already keeps a history array), lettered
panel labels, a natural-language "Ask a question" box, and moment importance from a temporal model in the detail timeline.
