// All data encodings live here. Interface chrome is grayscale, so color always means data.
import * as d3 from "d3";
import type { ColorBy, Meta, RatingTarget, Video } from "./types";

export const RATING_DOMAIN: [number, number] = [1, 7];
export const ratingColor = d3.scaleSequential(d3.interpolateViridis).domain(RATING_DOMAIN);

// Red = over-predicted (residual = predicted - actual > 0). Symmetric domain fixed from the full data.
export const RESIDUAL_MAX = 2.5;
export const residualColor = d3.scaleDiverging(d3.interpolateRdBu).domain([RESIDUAL_MAX, 0, -RESIDUAL_MAX]).clamp(true);

export const RATER_SD_DOMAIN: [number, number] = [0.3, 2.0];
export const raterSdColor = d3
  .scaleSequential((t: number) => d3.interpolatePurples(0.25 + 0.75 * t))
  .domain(RATER_SD_DOMAIN)
  .clamp(true);

// Okabe-Ito hues, fixed issue-to-color mapping in every view. Yellow darkened and black replaced
// (wine) so every swatch clears the lightness band against a white surface.
export const ISSUE_ORDER = ["climate_change", "russia_ukraine", "covid", "vaccine", "health", "alt_medicine", "election", "gmo"];
export const ISSUE_COLORS: Record<string, string> = {
  climate_change: "#009E73",
  russia_ukraine: "#0072B2",
  covid: "#D55E00",
  vaccine: "#56B4E9",
  health: "#E69F00",
  alt_medicine: "#B5A300",
  election: "#CC79A7",
  gmo: "#882255",
};
export const issueColor = (i: string) => ISSUE_COLORS[i] ?? "#999";

export const clusterColor = (c: number) => d3.schemeTableau10[c % 10];

export const ACCOUNT_COLORS: Record<string, string> = { popular: "#0072B2", unpopular: "#E69F00" };
export const IMPUTED_COLORS: Record<string, string> = { complete: "#9DB4CF", no_face: "#E69F00", silent: "#0072B2", both: "#882255" };
export const IMPUTED_LABELS: Record<string, string> = {
  complete: "No imputed values",
  no_face: "No faces (face time imputed)",
  silent: "No audio (audio features imputed)",
  both: "No faces and no audio",
};
export const SPEECH_COLORS: Record<string, string> = { yes: "#009E73", no: "#CC79A7" };

/** One wording for imputed values everywhere, with counts computed from the loaded videos. */
export function imputedSummary(videos: Video[]): string {
  const any = videos.filter((v) => v.imputed).length;
  const noFace = videos.filter((v) => v.no_face).length;
  const silent = videos.filter((v) => v.silent).length;
  const both = videos.filter((v) => v.no_face && v.silent).length;
  return `${any} videos have imputed values: ${noFace} without faces and ${silent} silent (${both} are both)`;
}

export const imputedClass = (v: Video) => (v.no_face && v.silent ? "both" : v.no_face ? "no_face" : v.silent ? "silent" : "complete");

export const SELECT_DIM = "#c8c8c8";

// Account type as shape: circle = popular, triangle = ordinary
export const accountSymbol = (t: string) => (t === "unpopular" ? d3.symbolTriangle : d3.symbolCircle);

export const RATING_TARGETS: Record<RatingTarget, { label: string; key: keyof Video; sd: keyof Video }> = {
  overall: { label: "Sensation rating (overall)", key: "rating", sd: "rater_sd" },
  arousal: { label: "Emotional arousal", key: "arousal", sd: "sd_arousal" },
  dramatic: { label: "Dramatic impact", key: "dramatic", sd: "sd_dramatic" },
  novelty: { label: "Novelty", key: "novelty", sd: "sd_novelty" },
};

export const ratingOf = (v: Video, t: RatingTarget) => v[RATING_TARGETS[t].key] as number;
export const ciOf = (v: Video, t: RatingTarget) => (1.96 * (v[RATING_TARGETS[t].sd] as number)) / Math.sqrt(v.n_raters);

export function colorFor(v: Video, colorBy: ColorBy, k: number, target: RatingTarget): string {
  switch (colorBy) {
    case "rating":
      return ratingColor(ratingOf(v, target));
    case "residual":
      return residualColor(v.residual);
    case "issue":
      return issueColor(v.issue);
    case "account":
      return ACCOUNT_COLORS[v.account_type];
    case "cluster":
      return clusterColor(v.cluster[String(k)]);
    case "raterSd":
      return raterSdColor(v.rater_sd);
    case "imputed":
      return IMPUTED_COLORS[imputedClass(v)];
    case "speech":
      return SPEECH_COLORS[v.has_speech ? "yes" : "no"];
  }
}

export const COLOR_BY_LABELS: Record<ColorBy, string> = {
  rating: "Rating",
  residual: "Model error",
  issue: "Issue",
  account: "Account type",
  cluster: "Cluster",
  raterSd: "Rater disagreement",
  imputed: "Imputed values",
  speech: "Speech",
};

export const accountLabel = (t: string) => (t === "unpopular" ? "Ordinary account" : "Popular account");
export const issueLabel = (meta: Meta | null, i: string) => meta?.issues[i] ?? i;
export const attrLabel = (meta: Meta, key: string) => meta.numeric_attrs[key]?.label ?? key;

export const fmt = (x: number | null | undefined, d = 2) => (x == null || Number.isNaN(x) ? "–" : x.toFixed(d).replace("-", "−"));
