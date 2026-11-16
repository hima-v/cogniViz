import * as d3 from "d3";
import { useMemo, useState } from "react";
import { ColorLegend, ShapeLegend } from "../components/Legend";
import { Panel, SourceLine, Tooltip, ui, useSize } from "../components/ui";
import { VideoTip } from "../components/VideoTip";
import { ISSUE_ORDER, RATING_TARGETS, SELECT_DIM, accountSymbol, colorFor, fmt, issueColor, ratingOf } from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import { binnedMeans, jitter, spearman } from "../stats";
import type { RatingTarget, Video } from "../types";

export const X_ATTRS = [
  "log_duration",
  "log_engagement",
  "year",
  "brightness",
  "saturation",
  "entropy",
  "warmness",
  "tempo",
  "loudness",
  "spec_centroid",
  "shotc_ps",
  "shotd_ps",
  "facec_ps",
  "faced_ps",
  "face_age_avg",
  "face_anger_avg",
  "face_disgust_avg",
  "face_fear_avg",
  "face_happiness_avg",
  "face_neutral_avg",
  "face_sadness_avg",
  "face_surprise_avg",
  "msv_sd",
  "residual",
];

const SOURCE_TEXT: Record<string, string> = {
  authors_meta: "authors' metadata",
  authors_features: "authors' features",
  authors_ratings: "authors' ratings",
  our_analysis: "our out-of-fold residuals",
};

const M = { l: 44, r: 12, t: 8, b: 40 };

export function Attributes() {
  const st = useAppState();
  const dispatch = useDispatch();
  const { meta } = useData();
  const x = st.xAttribute;
  const src = meta.numeric_attrs[x]?.source ?? "authors_meta";
  const sourceParts =
    st.v3Mode === "issue"
      ? [
          { id: "authors_ratings", text: "authors' ratings" },
          { id: "authors_meta", text: "authors' metadata (issue, account type)" },
        ]
      : [
          { id: "authors_ratings", text: "authors' ratings" },
          { id: src, text: SOURCE_TEXT[src] ?? src },
        ];
  return (
    <Panel
      title="Attributes"
      controls={
        <>
          <span className={ui.label} role="group" aria-label="View">
            <button className={`${ui.btn} ${st.v3Mode === "issue" ? ui.btnActive : ""}`} onClick={() => dispatch({ type: "set", patch: { v3Mode: "issue" } })}>
              By issue
            </button>
            <button className={`${ui.btn} ${st.v3Mode === "scatter" ? ui.btnActive : ""}`} onClick={() => dispatch({ type: "set", patch: { v3Mode: "scatter" } })}>
              Against an attribute
            </button>
          </span>
          <label className={ui.label}>
            Rating
            <select className={ui.select} value={st.ratingTarget} onChange={(e) => dispatch({ type: "set", patch: { ratingTarget: e.target.value as RatingTarget } })}>
              {(Object.keys(RATING_TARGETS) as RatingTarget[]).map((t) => (
                <option key={t} value={t}>
                  {RATING_TARGETS[t].label}
                </option>
              ))}
            </select>
          </label>
          {st.v3Mode === "scatter" && (
            <label className={ui.label}>
              x
              <select className={ui.select} value={x} onChange={(e) => dispatch({ type: "set", patch: { xAttribute: e.target.value } })}>
                {X_ATTRS.map((k) => (
                  <option key={k} value={k}>
                    {meta.numeric_attrs[k]?.label ?? k}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      }
      source={<SourceLine parts={sourceParts} />}
    >
      {st.v3Mode === "issue" ? <ByIssue /> : <Scatter />}
    </Panel>
  );
}

function useHover(filtered: Video[], pts: [number, number][]) {
  const dispatch = useDispatch();
  const [tip, setTip] = useState<{ v: Video; x: number; y: number } | null>(null);
  const delaunay = useMemo(() => d3.Delaunay.from(pts), [pts]);
  const find = (px: number, py: number) => {
    if (!pts.length) return null;
    const i = delaunay.find(px, py);
    return Math.hypot(pts[i][0] - px, pts[i][1] - py) < 8 ? filtered[i] : null;
  };
  const handlers = {
    onMouseMove: (e: React.MouseEvent<SVGRectElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const v = find(e.clientX - r.left, e.clientY - r.top);
      dispatch({ type: "hover", id: v?.id ?? null });
      setTip(v ? { v, x: e.clientX, y: e.clientY } : null);
    },
    onMouseLeave: () => {
      dispatch({ type: "hover", id: null });
      setTip(null);
    },
    onClick: (e: React.MouseEvent<SVGRectElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const v = find(e.clientX - r.left, e.clientY - r.top);
      if (v) dispatch({ type: "focus", id: v.id });
    },
  };
  const tipEl = tip && (
    <Tooltip x={tip.x} y={tip.y}>
      <VideoTip v={tip.v} />
    </Tooltip>
  );
  return { handlers, tipEl };
}

function YAxis({ y, h, target }: { y: d3.ScaleLinear<number, number>; h: number; target: RatingTarget }) {
  return (
    <g className={ui.axis}>
      {[1, 2, 3, 4, 5, 6, 7].map((t) => (
        <g key={t} transform={`translate(0,${y(t)})`}>
          <line x2={-4} stroke="#bbb" />
          <text x={-6} y={3} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      <text className={ui.axisLabel} transform={`translate(${-32},${h / 2}) rotate(-90)`} textAnchor="middle">
        {RATING_TARGETS[target].label} (1–7)
      </text>
    </g>
  );
}

function ByIssue() {
  const st = useAppState();
  const { filtered, selected, hasSelection, meta, byId } = useData();
  const [ref, size] = useSize<HTMLDivElement>();
  const w = Math.max(100, size.width - M.l - M.r);
  const h = Math.max(60, size.height - M.t - M.b);
  const bx = d3.scaleBand().domain(ISSUE_ORDER).range([0, w]).paddingInner(0.12);
  const sub = d3.scaleBand().domain(["popular", "unpopular"]).range([0, bx.bandwidth()]).padding(0.08);
  const yExt = d3.extent(filtered, (v) => ratingOf(v, st.ratingTarget)) as [number, number];
  const y = d3
    .scaleLinear()
    .domain([Math.max(1, Math.floor(yExt[0] ?? 1)), Math.min(7, Math.ceil(yExt[1] ?? 7))])
    .range([h, 0]);
  const sel = new Set(selected.map((v) => v.id));
  const pos = (v: Video): [number, number] => [
    bx(v.issue)! + sub(v.account_type)! + sub.bandwidth() * (0.5 + 0.7 * jitter(v.id)),
    y(ratingOf(v, st.ratingTarget)),
  ];
  const pts = filtered.map(pos);
  const { handlers, tipEl } = useHover(filtered, pts);
  const groups = d3.groups(filtered, (v) => v.issue, (v) => v.account_type);
  const hovered = st.hoveredId ? byId.get(st.hoveredId) : undefined;
  const sym = { popular: d3.symbol(accountSymbol("popular"), 18)() ?? "", unpopular: d3.symbol(accountSymbol("unpopular"), 18)() ?? "" };
  const ordered = hasSelection ? [...filtered.filter((v) => !sel.has(v.id)), ...selected] : filtered;
  // fixed y domain 1-7 when narrower data would otherwise distort comparisons across rating targets
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className={ui.legend}>
        <span>Points colored by issue; box = middle 50% and median; black dot and bar = mean and its 95% CI.</span>
        <ShapeLegend />
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
        <svg width={size.width} height={size.height}>
          <g transform={`translate(${M.l},${M.t})`}>
            <YAxis y={y} h={h} target={st.ratingTarget} />
            {ordered.map((v, i) => {
              const [px, py] = hasSelection ? pos(v) : pts[i];
              const dim = hasSelection && !sel.has(v.id);
              return (
                <path
                  key={v.id}
                  d={sym[v.account_type]}
                  transform={`translate(${px},${py})`}
                  fill={dim ? SELECT_DIM : issueColor(v.issue)}
                  fillOpacity={dim ? 0.2 : 0.55}
                  stroke={dim || !hasSelection ? "none" : "#222"}
                  strokeWidth={0.6}
                />
              );
            })}
            {groups.flatMap(([issue, accs]) =>
              accs.map(([acc, vs]) => {
                const vals = vs.map((v) => ratingOf(v, st.ratingTarget)).sort(d3.ascending);
                const q1 = d3.quantileSorted(vals, 0.25)!;
                const q2 = d3.quantileSorted(vals, 0.5)!;
                const q3 = d3.quantileSorted(vals, 0.75)!;
                const iqr = q3 - q1;
                const lo = d3.min(vals.filter((x) => x >= q1 - 1.5 * iqr))!;
                const hi = d3.max(vals.filter((x) => x <= q3 + 1.5 * iqr))!;
                const mean = d3.mean(vals)!;
                const ci = vals.length > 1 ? (1.96 * d3.deviation(vals)!) / Math.sqrt(vals.length) : 0;
                const x0 = bx(issue)! + sub(acc)!;
                const bw = sub.bandwidth();
                const cx = x0 + bw / 2;
                return (
                  <g key={issue + acc} pointerEvents="none">
                    <line x1={cx} x2={cx} y1={y(lo)} y2={y(q1)} stroke="#555" />
                    <line x1={cx} x2={cx} y1={y(q3)} y2={y(hi)} stroke="#555" />
                    <rect x={x0 + bw * 0.2} width={bw * 0.6} y={y(q3)} height={Math.max(1, y(q1) - y(q3))} fill="none" stroke="#444" strokeWidth={1.2} />
                    <line x1={x0 + bw * 0.2} x2={x0 + bw * 0.8} y1={y(q2)} y2={y(q2)} stroke="#222" strokeWidth={2} />
                    <line x1={x0 + bw * 0.88} x2={x0 + bw * 0.88} y1={y(mean - ci)} y2={y(mean + ci)} stroke="#000" strokeWidth={1.5} />
                    <circle cx={x0 + bw * 0.88} cy={y(mean)} r={2.5} fill="#000" />
                    <text x={cx} y={h + 11} fontSize={9} fill="#777" textAnchor="middle">
                      {acc === "popular" ? "popular" : "ordinary"} ({vs.length})
                    </text>
                  </g>
                );
              }),
            )}
            {ISSUE_ORDER.map((i) => (
              <g key={i}>
                <rect x={bx(i)!} y={h + 18} width={10} height={10} rx={2} fill={issueColor(i)} />
                <text x={bx(i)! + 14} y={h + 27} fontSize={11} fill="#222">
                  {meta.issues[i]}
                </text>
              </g>
            ))}
            {hovered && filtered.includes(hovered) && <circle cx={pos(hovered)[0]} cy={pos(hovered)[1]} r={5.5} fill="none" stroke="#111" strokeWidth={2} pointerEvents="none" />}
            <rect width={w} height={h} fill="transparent" {...handlers} />
          </g>
        </svg>
        {tipEl}
      </div>
    </div>
  );
}

function Scatter() {
  const st = useAppState();
  const { filtered, selected, hasSelection, meta, byId } = useData();
  const [ref, size] = useSize<HTMLDivElement>();
  const key = st.xAttribute;
  const info = meta.numeric_attrs[key];
  const w = Math.max(100, size.width - M.l - M.r - 150);
  const h = Math.max(60, size.height - M.t - M.b);
  const withX = filtered.filter((v) => v.attrs[key] != null);
  const missing = filtered.length - withX.length;
  const xs = withX.map((v) => v.attrs[key] as number);
  const ys = withX.map((v) => ratingOf(v, st.ratingTarget));
  const lo = d3.quantile(xs, 0.005) ?? 0;
  const hi = d3.quantile(xs, 0.995) ?? 1;
  const x = d3.scaleLinear().domain([lo, hi]).range([0, w]).nice().clamp(true);
  const yExt = d3.extent(ys) as [number, number];
  const y = d3
    .scaleLinear()
    .domain([Math.max(1, Math.floor(yExt[0] ?? 1)), Math.min(7, Math.ceil(yExt[1] ?? 7))])
    .range([h, 0]);
  const pts = withX.map((_, i) => [x(xs[i]), y(ys[i])] as [number, number]);
  const { handlers, tipEl } = useHover(withX, pts);
  const rho = spearman(xs, ys);
  const bins = binnedMeans(xs, ys);
  const sel = new Set(selected.map((v) => v.id));
  const selX = withX.filter((v) => sel.has(v.id));
  const rhoSel = spearman(
    selX.map((v) => v.attrs[key] as number),
    selX.map((v) => ratingOf(v, st.ratingTarget)),
  );
  const binsSel = selX.length >= 30 ? binnedMeans(selX.map((v) => v.attrs[key] as number), selX.map((v) => ratingOf(v, st.ratingTarget)), 6) : [];
  const isLog = key.startsWith("log_");
  const tickFmt = (d: d3.NumberValue) => (isLog ? d3.format("~s")(Math.round(10 ** +d)) : key === "year" ? String(d) : d3.format("~g")(+d));
  const line = d3
    .line<{ x: number; y: number }>()
    .x((d) => x(d.x))
    .y((d) => y(d.y));
  const hovered = st.hoveredId ? byId.get(st.hoveredId) : undefined;
  const order = d3.range(withX.length).sort((a, b) => Number(sel.has(withX[a].id)) - Number(sel.has(withX[b].id)));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ColorLegend colorBy={st.colorBy} />
      <div ref={ref} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <svg width={size.width} height={size.height}>
          <g transform={`translate(${M.l},${M.t})`}>
            <YAxis y={y} h={h} target={st.ratingTarget} />
            <g className={ui.axis} transform={`translate(0,${h})`}>
              {x.ticks(isLog ? 6 : 8).map((t) => (
                <g key={t} transform={`translate(${x(t)},0)`}>
                  <line y2={4} stroke="#bbb" />
                  <text y={14} textAnchor="middle">
                    {tickFmt(t)}
                  </text>
                </g>
              ))}
              <text className={ui.axisLabel} x={w / 2} y={32} textAnchor="middle">
                {info?.label} ({isLog ? info?.unit.replace("log10 ", "") + ", log scale" : info?.unit})
              </text>
            </g>
            {order.map((i) => {
              const v = withX[i];
              const dim = hasSelection && !sel.has(v.id);
              return (
                <path
                  key={v.id}
                  d={d3.symbol(accountSymbol(v.account_type), 18)() ?? ""}
                  transform={`translate(${pts[i][0]},${pts[i][1]})`}
                  fill={dim ? SELECT_DIM : colorFor(v, st.colorBy, st.k, st.ratingTarget)}
                  fillOpacity={dim ? 0.2 : 0.7}
                />
              );
            })}
            <path d={line(bins) ?? ""} fill="none" stroke="#111" strokeWidth={2} pointerEvents="none" />
            {binsSel.length > 0 && <path d={line(binsSel) ?? ""} fill="none" stroke="#111" strokeWidth={2} strokeDasharray="5 3" pointerEvents="none" />}
            {hovered && withX.includes(hovered) && (
              <circle cx={x(hovered.attrs[key] as number)} cy={y(ratingOf(hovered, st.ratingTarget))} r={5.5} fill="none" stroke="#111" strokeWidth={2} pointerEvents="none" />
            )}
            <rect width={w} height={h} fill="transparent" {...handlers} />
          </g>
          <g transform={`translate(${M.l + w + 18},${M.t + 6})`} fontSize={12}>
            <text>
              Spearman ρ = <tspan fontWeight={700}>{fmt(rho)}</tspan>
            </text>
            <text y={16}>n = {withX.length}</text>
            {missing > 0 && (
              <text y={32} fontSize={10.5} fill="#8a5a00">
                {missing} without a value (imputed
              </text>
            )}
            {missing > 0 && (
              <text y={45} fontSize={10.5} fill="#8a5a00">
                or missing) left out
              </text>
            )}
            {hasSelection && (
              <>
                <text y={68}>Selection: ρ = {fmt(rhoSel)}</text>
                <text y={84}>n = {selX.length}</text>
              </>
            )}
            <line x1={0} x2={18} y1={108} y2={108} stroke="#111" strokeWidth={2} />
            <text x={22} y={111} fontSize={10.5}>
              binned mean, shown videos
            </text>
            {hasSelection && (
              <>
                <line x1={0} x2={18} y1={124} y2={124} stroke="#111" strokeWidth={2} strokeDasharray="5 3" />
                <text x={22} y={127} fontSize={10.5}>
                  binned mean, selection (n ≥ 30)
                </text>
              </>
            )}
            <text y={150} fontSize={10.5} fill="#777">
              Association, not cause.
            </text>
          </g>
        </svg>
        {tipEl}
      </div>
    </div>
  );
}
