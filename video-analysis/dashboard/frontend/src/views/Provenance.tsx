import { useEffect, useRef } from "react";
import { ui } from "../components/ui";
import { fmt, imputedSummary } from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import css from "./Provenance.module.css";

export function ProvenancePanel() {
  const { provenanceOpen } = useAppState();
  const dispatch = useDispatch();
  const { meta, videos } = useData();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!provenanceOpen) return;
    ref.current?.focus();
    if (provenanceOpen !== "all") {
      const row = ref.current?.querySelector<HTMLElement>(`[data-source="${provenanceOpen}"]`);
      row?.scrollIntoView({ block: "center" });
    }
  }, [provenanceOpen]);

  if (!provenanceOpen) return null;
  const val = meta.validation;
  const docs = val.documented;
  return (
    <div className={css.backdrop} onClick={() => dispatch({ type: "provenance", open: null })}>
      <div
        ref={ref}
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Data sources"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={css.head}>
          <h2>Data sources</h2>
          <button className={ui.btn} onClick={() => dispatch({ type: "provenance", open: null })}>
            Close (Esc)
          </button>
        </div>
        <p className={css.summary}>
          Ratings, metadata and the 11 model features come from the original study (Xue et al., 2026). The temporal features and all analyses are ours.
          Both are joined on the survey video id (<code>survey_batch_id</code>). The two feature sets are never mixed in one calculation (apart from the
          agreement check below).
        </p>
        <table className={css.table}>
          <thead>
            <tr>
              <th>Source</th>
              <th>Origin</th>
              <th>What it contains</th>
              <th>Coverage (videos)</th>
              <th>File</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {meta.provenance.map((p) => (
              <tr key={p.id} data-source={p.id} className={provenanceOpen === p.id ? css.hl : undefined}>
                <td>
                  <b>{p.label}</b>
                </td>
                <td>{p.origin}</td>
                <td>{p.contains}</td>
                <td className={css.num}>
                  {p.coverage.toLocaleString()} of {meta.n_videos.toLocaleString()}
                  {p.coverage_note && <div className={ui.muted}>{p.coverage_note}</div>}
                </td>
                <td className={css.file}>{p.file}</td>
                <td className={css.date}>{p.last_modified ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 data-source-anchor="validation">Agreement between our features and the authors' features</h3>
        {val.computed ? (
          <>
            <p className={css.note}>
              {val.computed.method} n = {val.computed.n_videos} videos. Pearson r by group:{" "}
              {Object.entries(val.computed.groups)
                .map(([g, [lo, hi]]) => `${g} ${fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`}`)
                .join(" · ")}
              . Week 2 report: visual r = {docs.visual}, shots {docs.shots}, audio {docs.audio}.
            </p>
            <div className={css.chips}>
              {Object.entries(val.computed.per_feature).map(([k, f]) => (
                <span key={k} className={css.chip}>
                  {f.label}: r = {fmt(f.r)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className={css.note}>
            Our whole-video features were not found, so agreement is shown from the Week 2 report: visual r = {docs.visual}, shots {docs.shots}, audio{" "}
            {docs.audio} ({docs.label}).
          </p>
        )}

        <h3>Why the authors' features drive the projection and model</h3>
        <p className={css.note}>
          They cover all 1,200 videos and include faces, so the map, clusters and predictions stay comparable to the published baseline (CV MSE about 0.517; this
          build: {fmt(meta.cv_mse, 3)}). Our features cover {meta.provenance.find((p) => p.id === "our_features")?.coverage ?? 0} videos and have no face
          features yet, so they appear only in the timeline and the experiments view.
        </p>
        <h3>Missing and imputed values</h3>
        <p className={css.note}>
          {imputedSummary(videos)}. Face time is undefined without faces and audio features are undefined without sound; the model input fills these
          with imputed values. The dashboard flags them, leaves them out of attribute plots and comparisons, and can hide them. {meta.null_roles.likes_missing.n} videos lack like counts (left out of engagement), {meta.null_roles.no_speech.n} have no transcript, and{" "}
          {meta.null_roles.face_pp_missing.n} lack Face++ attributes. Generated {meta.generated}.
        </p>
      </div>
    </div>
  );
}
