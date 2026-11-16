import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";
import { fetchDetail, mediaUrl } from "../api";
import { SourceLine, ui } from "../components/ui";
import { accountLabel, fmt, issueColor, residualColor } from "../encodings";
import { useAppState, useData } from "../state";
import type { Detail as DetailT, Meta, Video } from "../types";
import css from "./Detail.module.css";

const BIN_LABELS: Record<string, string> = {
  brightness: "Brightness",
  saturation: "Color saturation",
  warmness: "Color warmth",
  entropy: "Visual complexity",
  loudness: "Loudness",
  spec_centroid: "Sound sharpness",
  shot_changes: "Shot changes",
};

export function Detail() {
  const st = useAppState();
  const { byId, selected, hasSelection } = useData();
  const [detail, setDetail] = useState<DetailT | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const v = st.focusedId ? byId.get(st.focusedId) : undefined;

  useEffect(() => {
    if (!st.focusedId) {
      setDetail(null);
      return;
    }
    let live = true;
    const t0 = performance.now();
    fetchDetail(st.focusedId)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setErr(null);
        setLoadMs(Math.round(performance.now() - t0));
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [st.focusedId]);

  // Prefetch on hover so a click opens instantly.
  useEffect(() => {
    if (!st.hoveredId) return;
    const t = setTimeout(() => void fetchDetail(st.hoveredId!).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [st.hoveredId]);

  const withBins = selected.filter((x) => x.has_bins).length;
  return (
    <section className={css.panel} aria-label="Video detail">
      <div className={css.head}>
        <h2 className={css.title}>Video detail</h2>
        {loadMs != null && v && <span className={ui.muted} style={{ fontSize: 10 }}>loaded in {loadMs} ms</span>}
      </div>
      {hasSelection && (
        <div className={css.coverage}>
          {withBins} of {selected.length} selected videos have temporal features (our extraction covers batches 1–6, 9, 10).
        </div>
      )}
      <div className={css.scroll}>
        {!v ? (
          <div className={ui.empty}>Click a video in any view (map, prediction plot, samples) to see it here.</div>
        ) : err ? (
          <div className={ui.empty}>Could not load details: {err}</div>
        ) : !detail || detail.id !== v.id ? (
          <div className={ui.empty}>Loading…</div>
        ) : (
          <Body v={v} d={detail} />
        )}
      </div>
      <SourceLine
        parts={[
          { id: "authors_meta", text: "mixed, labeled per section: authors' metadata, ratings and features" },
          { id: "our_features", text: "timeline from our features" },
        ]}
        coverage="timeline for 960 videos"
      />
    </section>
  );
}

function Section({ title, source, children }: { title: string; source?: { id: string; text: string }[]; children: React.ReactNode }) {
  return (
    <div className={css.section}>
      <h3 className={css.h3}>{title}</h3>
      {children}
      {source && <SourceLine parts={source} />}
    </div>
  );
}

function Body({ v, d }: { v: Video; d: DetailT }) {
  const { meta } = useData();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [videoErr, setVideoErr] = useState(false);
  useEffect(() => {
    setTime(0);
    setVideoErr(false);
  }, [v.id]);
  const also = d.tags.filter((t) => t !== v.issue);
  const seek = (s: number) => {
    if (videoRef.current) videoRef.current.currentTime = s;
    setTime(s);
  };
  return (
    <>
      <Section title="Video" source={[{ id: "authors_meta", text: "authors' metadata" }]}>
        {v.has_video && !videoErr ? (
          <video
            ref={videoRef}
            key={v.id}
            className={css.video}
            src={mediaUrl(v.id)}
            controls
            preload="metadata"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            onError={() => setVideoErr(true)}
          />
        ) : (
          <div className={css.noVideo}>{v.has_video ? "Video file could not be streamed (check the Box folder is synced)." : "Video file not available locally (batch 7 or 8)."}</div>
        )}
        <div className={css.facts}>
          <div>
            <span className={ui.swatch} style={{ background: issueColor(v.issue) }} /> <b>{meta.issues[v.issue]}</b>
            {also.length > 0 && <span className={ui.muted}> · also tagged: {also.map((t) => meta.issues[t] ?? t).join(", ")}</span>}
          </div>
          <div>
            {d.account ? `@${d.account}` : "unknown account"} · {accountLabel(v.account_type)}
          </div>
          <div>
            Posted {d.posted ?? "–"} · {fmt(v.duration, 1)} s · {v.aspect}
          </div>
          <div>
            {d.views != null ? d3.format(",")(d.views) : "–"} views · {d.likes != null ? d3.format(",")(d.likes) : "likes missing"} likes ·{" "}
            {d.comments != null ? d3.format(",")(d.comments) : "–"} comments
          </div>
          {d.url && (
            <div>
              <a href={d.url} target="_blank" rel="noreferrer">
                Original post
              </a>{" "}
              <span className={ui.muted}>· id {v.id}</span>
            </div>
          )}
        </div>
      </Section>

      <Section title="Rating" source={[{ id: "authors_ratings", text: "authors' ratings" }, { id: "our_analysis", text: "our out-of-fold prediction" }]}>
        <RatingStrip v={v} />
      </Section>

      <Section title="17 scale items vs dataset median" source={[{ id: "authors_ratings", text: "authors' ratings" }]}>
        <ItemPlot d={d} n={v.n_raters} meta={meta} />
      </Section>

      <Section title="Features (percentile among all videos)" source={[{ id: "authors_features", text: "authors' features" }]}>
        {v.imputed && (
          <div className={ui.warn} style={{ marginBottom: 3 }}>
            Imputed: {[v.no_face && "no faces detected, so face time is filled in", v.silent && "no audio track, so audio features are filled in"].filter(Boolean).join("; ")}.
            The model used filled-in values; they are left out here.
          </div>
        )}
        <Percentiles d={d} meta={meta} />
      </Section>

      <Section
        title="Timeline"
        source={[{ id: "our_features", text: "our features, 0.5 s bins (960 videos)" }]}
      >
        {d.bins ? (
          <Timeline d={d} time={time} onSeek={seek} />
        ) : (
          <div className={ui.empty} style={{ padding: 6 }}>
            {v.has_video ? "Timeline not extracted yet (run extract_features.py)." : "Timeline not extracted yet (batches 7 and 8 missing)."}
          </div>
        )}
        {/* TODO(v0.2): per-moment importance from the temporal model (TCN / MIL / occlusion) */}
        <div className={css.todo}>Moment importance (temporal model) — planned for v0.2</div>
      </Section>

      <Section title="Text" source={[{ id: "authors_meta", text: "authors' metadata" }]}>
        <TextBlock label="Caption" text={d.caption} empty="No caption" />
        <TextBlock label="Transcript" text={d.transcript} empty="No speech detected" />
        <TextBlock label="First comment" text={d.first_comment} empty="No comments" />
      </Section>
    </>
  );
}

function RatingStrip({ v }: { v: Video }) {
  const W = 300;
  const x = d3.scaleLinear().domain([1, 7]).range([10, W - 10]);
  return (
    <div>
      <svg width={W} height={52} aria-label="Actual and predicted rating on the 1 to 7 scale">
        <line x1={x(1)} x2={x(7)} y1={34} y2={34} stroke="#ccc" />
        {[1, 2, 3, 4, 5, 6, 7].map((t) => (
          <g key={t} transform={`translate(${x(t)},34)`}>
            <line y2={4} stroke="#bbb" />
            <text y={14} fontSize={9} textAnchor="middle" fill="#666">
              {t}
            </text>
          </g>
        ))}
        <line x1={x(v.rating - v.ci95)} x2={x(v.rating + v.ci95)} y1={12} y2={12} stroke="#000" strokeWidth={1.5} />
        <circle cx={x(v.rating)} cy={12} r={4} fill="#000" />
        <text x={x(v.rating) + 7} y={9} fontSize={10}>
          actual
        </text>
        <line x1={x(v.pred - 1.96 * v.pred_sd)} x2={x(v.pred + 1.96 * v.pred_sd)} y1={25} y2={25} stroke={residualColor(v.residual)} strokeWidth={1.5} />
        <rect x={x(v.pred) - 3.5} y={21.5} width={7} height={7} fill={residualColor(v.residual)} stroke="#333" strokeWidth={0.5} />
        <text x={x(v.pred) + 7} y={28} fontSize={10}>
          predicted
        </text>
      </svg>
      <div className={css.small}>
        Actual {fmt(v.rating)} (95% CI ±{fmt(v.ci95)}; {v.n_raters} raters, SD {fmt(v.rater_sd)}) · predicted {fmt(v.pred)} (spread across CV repeats ±
        {fmt(1.96 * v.pred_sd)}) · error {fmt(v.residual)}
      </div>
    </div>
  );
}

function ItemPlot({ d, n, meta }: { d: DetailT; n: number; meta: Meta }) {
  const W = 310;
  const L = 110;
  const x = d3.scaleLinear().domain([1, 7]).range([L, W - 8]);
  const rows: { dim: string; item: string }[] = Object.entries(meta.items).flatMap(([dim, items]) => items.map((item) => ({ dim, item })));
  const H = rows.length * 12 + Object.keys(meta.items).length * 14 + 14;
  let y = 0;
  let prevDim = "";
  return (
    <svg width={W} height={H} aria-label="Item ratings">
      {rows.map(({ dim, item }) => {
        const out = [];
        if (dim !== prevDim) {
          y += 14;
          const dm = d.dimensions[dim === "Emotional arousal" ? "arousal" : dim === "Dramatic impact" ? "dramatic" : "novelty"];
          out.push(
            <text key={dim} x={0} y={y - 2} fontSize={10.5} fontWeight={700} fill="#222">
              {dim} {dm?.m != null && <tspan fontWeight={400} fill="#555">· mean {fmt(dm.m)}</tspan>}
            </text>,
          );
          prevDim = dim;
        }
        const it = d.items[item];
        const ci = it.sd != null ? (1.96 * it.sd) / Math.sqrt(n) : 0;
        const med = meta.item_median[item];
        const yy = y + 6;
        y += 12;
        out.push(
          <g key={item}>
            <text x={L - 6} y={yy + 3} fontSize={10} textAnchor="end" fill="#444">
              {meta.item_labels[item]}
            </text>
            <line x1={x(1)} x2={x(7)} y1={yy} y2={yy} stroke="#eee" />
            <line x1={x(med)} x2={x(med)} y1={yy - 4} y2={yy + 4} stroke="#999" strokeWidth={1.5} />
            {it.m != null && (
              <>
                <line x1={x(Math.max(1, it.m - ci))} x2={x(Math.min(7, it.m + ci))} y1={yy} y2={yy} stroke="#000" />
                <circle cx={x(it.m)} cy={yy} r={2.8} fill="#000" />
              </>
            )}
          </g>,
        );
        return out;
      })}
      <g transform={`translate(0,${y + 4})`}>
        {[1, 4, 7].map((t) => (
          <text key={t} x={x(t)} y={8} fontSize={9} textAnchor="middle" fill="#666">
            {t}
          </text>
        ))}
        <text x={0} y={8} fontSize={9} fill="#777">
          dot ± 95% CI; gray tick = median
        </text>
      </g>
    </svg>
  );
}

function Percentiles({ d, meta }: { d: DetailT; meta: Meta }) {
  const W = 310;
  const L = 150;
  const x = d3.scaleLinear().domain([0, 1]).range([L, W - 30]);
  return (
    <svg width={W} height={meta.features.length * 13 + 14} aria-label="Feature percentiles">
      {meta.features.map((f, i) => {
        const p = d.features[f.key];
        const y = i * 13 + 7;
        return (
          <g key={f.key}>
            <text x={L - 6} y={y + 3} fontSize={10} textAnchor="end" fill="#444">
              {f.label}
            </text>
            <line x1={x(0)} x2={x(1)} y1={y} y2={y} stroke="#e6e6e6" strokeWidth={5} strokeLinecap="round" />
            <line x1={x(0.5)} x2={x(0.5)} y1={y - 4} y2={y + 4} stroke="#bbb" />
            {p.imputed || p.percentile == null ? (
              <text x={x(0.5)} y={y + 3} fontSize={9} textAnchor="middle" fill="#8a5a00">
                imputed
              </text>
            ) : (
              <>
                <circle cx={x(p.percentile)} cy={y} r={3.2} fill="#222" />
                <text x={W - 26} y={y + 3} fontSize={9.5} fill="#555">
                  {Math.round(p.percentile * 100)}
                </text>
              </>
            )}
          </g>
        );
      })}
      <text x={L} y={meta.features.length * 13 + 12} fontSize={9} fill="#777">
        0 = lowest of 1,200 · tick = median
      </text>
    </svg>
  );
}

function Timeline({ d, time, onSeek }: { d: DetailT; time: number; onSeek: (s: number) => void }) {
  const bins = d.bins!;
  const dur = d.events?.duration ?? bins.t_end[bins.t_end.length - 1];
  const W = 310;
  const L = 92;
  const RH = 22;
  const keys = Object.keys(BIN_LABELS).filter((k) => bins.features[k]);
  const x = d3.scaleLinear().domain([0, dur]).range([L, W - 6]);
  const H = keys.length * (RH + 3) + 22;
  const cuts = d.events?.cuts ?? [];
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <div>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          const r = svgRef.current!.getBoundingClientRect();
          const s = x.invert(e.clientX - r.left);
          if (s >= 0 && s <= dur) onSeek(s);
        }}
        aria-label="Feature timeline; click to seek the video"
      >
        {keys.map((k, i) => {
          const vals = bins.features[k];
          const ext = d3.extent(vals.filter((v): v is number => v != null)) as [number, number];
          const y = d3
            .scaleLinear()
            .domain(ext[0] === ext[1] ? [ext[0] - 1, ext[0] + 1] : ext)
            .range([i * (RH + 3) + RH, i * (RH + 3) + 2]);
          const pts = vals.map((v, j) => [(bins.t_start[j] + bins.t_end[j]) / 2, v] as [number, number | null]);
          const line = d3
            .line<[number, number | null]>()
            .defined((p) => p[1] != null)
            .x((p) => x(p[0]))
            .y((p) => y(p[1] as number));
          return (
            <g key={k}>
              <text x={L - 5} y={i * (RH + 3) + RH / 2 + 4} fontSize={9.5} textAnchor="end" fill="#444">
                {BIN_LABELS[k]}
              </text>
              <rect x={L} y={i * (RH + 3)} width={W - 6 - L} height={RH} fill="#fafafa" />
              {k === "shot_changes" ? (
                vals.map((v, j) =>
                  v ? <rect key={j} x={x(bins.t_start[j])} width={Math.max(1, x(bins.t_end[j]) - x(bins.t_start[j]) - 0.5)} y={y(v)} height={y(0) - y(v)} fill="#555" /> : null,
                )
              ) : (
                <path d={line(pts) ?? ""} fill="none" stroke="#333" strokeWidth={1.2} />
              )}
            </g>
          );
        })}
        {cuts.map((c) => (
          <line key={c} x1={x(c)} x2={x(c)} y1={0} y2={keys.length * (RH + 3) - 3} stroke="#999" strokeDasharray="1 2" />
        ))}
        <line x1={x(Math.min(time, dur))} x2={x(Math.min(time, dur))} y1={0} y2={keys.length * (RH + 3)} stroke="#c00" strokeWidth={1.5} />
        <g transform={`translate(0,${keys.length * (RH + 3) + 2})`}>
          {x.ticks(6).map((t) => (
            <text key={t} x={x(t)} y={10} fontSize={9} textAnchor="middle" fill="#666">
              {t}
            </text>
          ))}
          <text x={W - 6} y={19} fontSize={9} textAnchor="end" fill="#666">
            seconds
          </text>
        </g>
      </svg>
      <div className={css.small}>
        Each row on its own scale (min to max within this video). Dotted lines = detected shot boundaries ({cuts.length}); red line = playback position, click
        to seek. Tempo is one value per video{d.events?.tempo != null ? `: ${fmt(d.events.tempo, 0)} BPM` : ""}.
      </div>
    </div>
  );
}

function TextBlock({ label, text, empty }: { label: string; text: string | null; empty: string }) {
  return (
    <div className={css.text}>
      <div className={css.textLabel}>{label}</div>
      <div className={css.textBody}>{text ?? <span className={ui.muted}>{empty}</span>}</div>
    </div>
  );
}
