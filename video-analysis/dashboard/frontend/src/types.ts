export type Method = "tsne" | "umap" | "pca";

export interface Video {
  id: string;
  issue: string;
  tags: string[];
  account_type: "popular" | "unpopular";
  account: string;
  rating: number;
  arousal: number;
  dramatic: number;
  novelty: number;
  rater_sd: number;
  sd_arousal: number;
  sd_dramatic: number;
  sd_novelty: number;
  n_raters: number;
  ci95: number;
  pred: number;
  pred_sd: number;
  residual: number;
  sq_err: number;
  duration: number;
  aspect: string;
  has_speech: boolean;
  posted: string | null;
  no_face: boolean;
  silent: boolean;
  imputed: boolean;
  has_bins: boolean;
  has_video: boolean;
  xy: Record<Method, [number, number]>;
  cluster: Record<string, number>;
  attrs: Record<string, number | null>;
}

export interface ClusterRow {
  cluster: number;
  n: number;
  mse: number;
  mean_rating: number;
  ci95: number;
  issue_mix: Record<string, number>;
  pct_popular: number;
  profile: Record<string, number>;
  label: string;
  medoid: Record<Method, [number, number]>;
  spread: Record<Method, number>;
  diffuse: Record<Method, boolean>;
}

export interface ClusterTable {
  k: number;
  silhouette: number;
  clusters: ClusterRow[];
}

export interface Provenance {
  id: string;
  label: string;
  origin: string;
  contains: string;
  coverage: number;
  coverage_note: string;
  file: string;
  last_modified: string | null;
}

export interface Meta {
  n_videos: number;
  cv_mse: number;
  cv_mse_sd: number;
  cv: string;
  rf_params: Record<string, string | number>;
  projection_params: Record<Method, Record<string, string | number | number[]>>;
  clusters: Record<string, ClusterTable>;
  item_median: Record<string, number>;
  items: Record<string, string[]>;
  item_labels: Record<string, string>;
  features: { key: string; label: string; group: string }[];
  numeric_attrs: Record<string, { label: string; unit: string; source: string }>;
  issues: Record<string, string>;
  accounts: Record<string, string>;
  null_roles: Record<string, { n: number; fields: string[] }>;
  validation: {
    computed: null | {
      per_feature: Record<string, { r: number; n: number; label: string }>;
      groups: Record<string, [number, number]>;
      n_videos: number;
      method: string;
    };
    documented: Record<string, string>;
  };
  provenance: Provenance[];
  generated: string;
}

export interface Insight {
  id: string;
  title: string;
  finding: string;
  n: number;
  method: string;
  caveat: string;
  sources: string[];
  apply: Partial<ApplyState>;
}

export interface ExperimentRow {
  table: "comparison" | "controls";
  condition: string;
  n_features: string;
  seed: number;
  cv_mse: number;
  sd_across_repeats: number;
}

export interface Detail {
  id: string;
  items: Record<string, { m: number | null; sd: number | null }>;
  dimensions: Record<string, { m: number | null; sd: number | null }>;
  caption: string | null;
  transcript: string | null;
  first_comment: string | null;
  url: string | null;
  tags: string[];
  account: string | null;
  posted: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  face: { n_faces_avg: number | null; age_avg: number | null; female_share: number | null; size: number | null; emotions: Record<string, number | null> };
  features: Record<string, { raw: number | null; model_value: number | null; percentile: number | null; imputed: boolean }>;
  bins: null | { t_start: number[]; t_end: number[]; features: Record<string, (number | null)[]> };
  events: null | { duration: number; fps: number; has_audio: boolean; tempo: number | null; cuts: number[]; beats: number[]; bin_sec: number };
}

export interface NumericCompare {
  key: string;
  label: string;
  unit: string;
  source: string;
  g: number | null;
  g_lo: number | null;
  g_hi: number | null;
  mean_a: number | null;
  mean_b: number | null;
  n_a: number;
  n_b: number;
  missing_a: number;
  missing_b: number;
  scale_min: number | null;
  scale_max: number | null;
}

export interface CategoricalCompare {
  key: string;
  label: string;
  source: string;
  categories: { category: string; share_a: number; share_b: number; diff_pp: number }[];
  top: { category: string; share_a: number; share_b: number; diff_pp: number } | null;
  max_abs_pp: number;
}

export interface CompareResult {
  n_a: number;
  n_b: number;
  small_group: boolean;
  numeric: NumericCompare[];
  categorical: CategoricalCompare[];
}

// ---- state shared across views
export type ColorBy = "rating" | "residual" | "issue" | "account" | "cluster" | "raterSd" | "imputed" | "speech";
export type RatingTarget = "overall" | "arousal" | "dramatic" | "novelty";
export type BottomTab = "different" | "attributes" | "experiments";
export type SampleSort = "rating" | "residual" | "rater_sd" | "duration";

export interface Filters {
  issues: string[]; // empty = all
  tagMode: "sampled" | "any";
  accountTypes: string[];
  aspects: string[];
  speech: "all" | "yes" | "no";
  hideImputed: boolean;
  hideNoFace: boolean;
}

export interface ApplyState {
  colorBy: ColorBy;
  projection: Method;
  k: number;
  ratingTarget: RatingTarget;
  xAttribute: string;
  v3Mode: "issue" | "scatter";
  bottomTab: BottomTab;
  showCI: boolean;
  showLabels: boolean;
  showContours: boolean;
  filters: Partial<Filters>;
}
