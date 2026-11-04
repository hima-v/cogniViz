# Content

This folder supplements the manuscript: "A Computational Model of Message Sensation Value in Short Video Multimodal Features that Predicts Sensory and Behavioral Engagement." (*Computational Communication Research*, in press) It contains:

**code**

1.1 MSV Computational Model Test.ipynb: Notebook for applying the computational model of MSV to predict MSV scores for short videos, including details on feature extraction.

1.2 MSV Computational Model Development.ipynb: Notebook that replicates the process used to develop the computational model of MSV, including data preprocessing, feature preparation, model training, and model evaluation.

1.3 MSV Analysis Replication Notebook.Rmd: R Markdown file containing the replication code used to reproduce the statistical analyses reported in the manuscript.

**data**

2.1 msv_df.csv: Dataset of 1,200 short videos analyzed in the main study.

2.2 msv_df_by_participant.csv: Participant-level dataset containing 10,070 short-video evaluations from N = 1,007 participants in the main study.

2.3 msv_df_imputed.csv: Dataset of 1,200 short videos with imputed multimodal features used for model development. This imputed version is provided to support reproducibility because additional features beyond the final 11 features were used for imputation.

2.4 msv_testset_science.csv: Test dataset of science-related TikTok videos.

2.5 msv_testset_kid.csv: Test dataset of short videos recommended to children.

**model**

3.1 msv_model.joblib: Pre-trained machine learning model used to predict MSV scores for short videos.

3.2 msv_scaler.joblib: Scaler used to standardize input features before prediction, ensuring consistency with the model development pipeline.

# Reproducing

To construct a reproducible computational environment and reproduce the results in the paper, please use [Docker](https://www.docker.com/) (preferably in rootless mode; otherwise add `sudo`). At the root level of this project:

```bash
docker compose build
docker compose up
```

It should generate two HTML files (see `Makefile`):

1. `MSV-Development-Notebook.html` (Machine learning)
2. `MSV-Analysis-Replication-Notebook.html` (Regression, visualization)

# Development environment

Analyses were run on a local MacBook Air running macOS Tahoe, using Python 3.9.12 and R 4.5.0 in RStudio 2026.01.1+403. Computational reproducibility was confirmed using Python 3.12.5 and R 4.5.3 on Debian Linux 12 (See `Dockerfile`).

