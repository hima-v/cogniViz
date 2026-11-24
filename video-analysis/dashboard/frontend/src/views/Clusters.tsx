import * as d3 from "d3";
import { useState, type ReactNode } from "react";
import { Panel, SourceLine, ui } from "../components/ui";
import { ISSUE_ORDER, clusterColor, fmt, issueColor } from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import type { ClusterRow } from "../types";
import css from "./Clusters.module.css";

type SortKey = "cluster" | "n" | "mean_rating" | "mse" | "pct_popular" | "label";
const Z_MAX = 1.5;
const GLYPH_BAR = 6;
const GLYPH_GAP = 1;
const GROUP_GAP = 5;

export function Clusters() {
  const st = useAppState();
  const dispatch = useDispatch();
  const { meta, filtered } = useData();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "n", desc: true });
  const table = meta.clusters[String(st.k)];
  const rows = [...table.clusters].sort((a, b) => {
    const va = a[sort.key];
    const vb = b[sort.key];
    const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sort.desc ? -c : c;
  });
  const maxN = d3.max(table.clusters, (c) => c.n)!;
  const maxMse = Math.max(d3.max(table.clusters, (c) => c.mse)!, meta.cv_mse) * 1.05;
  const feats = meta.features;
  const glyphW = feats.length * (GLYPH_BAR + GLYPH_GAP) + 3 * GROUP_GAP;
  const featX = (i: number) => {
    let x = i * (GLYPH_BAR + GLYPH_GAP);
    for (let j = 1; j <= i; j++) if (feats[j].group !== feats[j - 1].group) x += GROUP_GAP;
    return x;
  };
  const zy = d3.scaleLinear().domain([-Z_MAX, Z_MAX]).range([22, 0]).clamp(true);
  const rx = d3.scaleLinear().domain([1, 7]).range([4, 52]);
  const selectCluster = (c: ClusterRow) =>
    dispatch({ type: "select", ids: filtered.filter((v) => v.cluster[String(st.k)] === c.cluster).map((v) => v.id) });
  const head = (key: SortKey, label: string, title?: string, extra?: ReactNode) => (
    <th
      className={css.sortable}
      title={title ?? `Sort by ${label}`}
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
    >
      {label}
      {sort.key === key ? (sort.desc ? " ▾" : " ▴") : ""}
      {extra}
    </th>
  );
  // group separators for the glyph legend
  const groupStarts = feats.map((f, i) => (i === 0 || f.group !== feats[i - 1].group ? { i, group: f.group } : null)).filter(Boolean) as { i: number; group: string }[];

  return (
    <Panel
      title="Cluster patterns"
      scroll
      controls={
        <label className={ui.label}>
          k
          <select className={ui.select} value={st.k} onChange={(e) => dispatch({ type: "set", patch: { k: Number(e.target.value) } })}>
            {Object.values(meta.clusters).map((t) => (
              <option key={t.k} value={t.k}>
                {t.k} (silhouette {fmt(t.silhouette, 3)})
              </option>
            ))}
          </select>
        </label>
      }
      source={
        <SourceLine
          parts={[
            { id: "our_analysis", text: "our k-means clusters" },
            { id: "authors_features", text: "authors' features they are fit on (all 1,200 videos)" },
          ]}
        />
      }
    >
      <div className={ui.legend}>
        <span>Issues bar:</span>
        {ISSUE_ORDER.map((i) => (
          <span key={i} className={ui.legendItem}>
            <span className={ui.swatch} style={{ background: issueColor(i) }} />
            {meta.issues[i]}
          </span>
        ))}
      </div>
      <table className={css.table}>
        <thead>
          <tr>
            {head("label", "Cluster")}
            {head("n", "n")}
            <th>
              <svg width={glyphW} height={30} style={{ overflow: "visible" }} aria-label="Glyph legend: bars are mean z-scores of the 11 features">
                {groupStarts.map((g, gi) => (
                  <text key={g.group} x={featX(g.i)} y={gi % 2 ? 12 : 5} fontSize={8} fill="#666">
                    {g.group}
                  </text>
                ))}
                {feats.map((f, i) => (
                  <rect key={f.key} x={featX(i)} y={14} width={GLYPH_BAR} height={6} fill="#bbb">
                    <title>{f.label}</title>
                  </rect>
                ))}
                <text x={0} y={29} fontSize={8} fill="#888">
                  bars: mean z, ±{Z_MAX} SD
                </text>
              </svg>
            </th>
            {head(
              "mean_rating",
              "Rating (CI)",
              "Mean rating with 95% CI on a 1–7 axis",
              <svg width={56} height={16} style={{ display: "block", marginLeft: -1 }} aria-label="Rating axis, 1 to 7">
                <line x1={rx(1)} x2={rx(7)} y1={11} y2={11} stroke="#bbb" />
                {[1, 2, 3, 4, 5, 6, 7].map((v) => (
                  <line key={v} x1={rx(v)} x2={rx(v)} y1={v % 3 === 1 ? 8 : 9.5} y2={11} stroke="#999" />
                ))}
                {[1, 4, 7].map((v) => (
                  <text key={v} x={rx(v)} y={7} fontSize={8} textAnchor="middle" fill="#666">
                    {v}
                  </text>
                ))}
              </svg>,
            )}
            {head("mse", "MSE", "Out-of-fold model error (MSE) within the cluster; tick = overall")}
            <th>Issues</th>
            {head("pct_popular", "Popular", "% of videos from popular accounts")}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const active = st.hoverGroup?.kind === "cluster" && st.hoverGroup.value === c.cluster;
            return (
              <tr
                key={c.cluster}
                className={active ? css.hot : undefined}
                tabIndex={0}
                onClick={() => selectCluster(c)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectCluster(c)}
                onMouseEnter={() => dispatch({ type: "hoverGroup", group: { kind: "cluster", value: c.cluster } })}
                onMouseLeave={() => dispatch({ type: "hoverGroup", group: null })}
              >
                <td className={css.labelCell}>
                  <span className={ui.swatch} style={{ background: clusterColor(c.cluster) }} />
                  <span>{c.label}</span>
                </td>
                <td>
                  <svg width={40} height={14}>
                    <rect width={(c.n / maxN) * 16} height={8} y={3} rx={2} fill="#888" />
                    <text x={19} y={11} fontSize={10.5} fill="#333">
                      {c.n}
                    </text>
                  </svg>
                </td>
                <td>
                  <svg width={glyphW} height={22}>
                    <line x1={0} x2={glyphW} y1={zy(0)} y2={zy(0)} stroke="#ccc" />
                    {groupStarts.slice(1).map((g) => (
                      <line key={g.group} x1={featX(g.i) - GROUP_GAP / 2} x2={featX(g.i) - GROUP_GAP / 2} y1={0} y2={22} stroke="#e2e2e2" />
                    ))}
                    {feats.map((f, i) => {
                      const z = c.profile[f.key];
                      return (
                        <rect key={f.key} x={featX(i)} width={GLYPH_BAR} y={Math.min(zy(0), zy(z))} height={Math.max(0.5, Math.abs(zy(z) - zy(0)))} fill={z >= 0 ? "#444" : "#999"}>
                          <title>
                            {f.label}: {z >= 0 ? "+" : "−"}
                            {Math.abs(z).toFixed(2)} SD from the dataset mean
                          </title>
                        </rect>
                      );
                    })}
                  </svg>
                </td>
                <td>
                  <svg width={56} height={18} aria-label={`Mean rating ${fmt(c.mean_rating)}`}>
                    <line x1={rx(1)} x2={rx(7)} y1={9} y2={9} stroke="#ddd" />
                    {[1, 4, 7].map((t) => (
                      <line key={t} x1={rx(t)} x2={rx(t)} y1={6} y2={12} stroke="#ccc" />
                    ))}
                    <line x1={rx(c.mean_rating - c.ci95)} x2={rx(c.mean_rating + c.ci95)} y1={9} y2={9} stroke="#000" strokeWidth={1.5} />
                    <circle cx={rx(c.mean_rating)} cy={9} r={3} fill="#000" />
                    <title>
                      {fmt(c.mean_rating)} (95% CI ±{fmt(c.ci95)}) on the 1–7 scale
                    </title>
                  </svg>
                </td>
                <td>
                  <svg width={40} height={14} aria-label={`MSE ${fmt(c.mse, 3)}`}>
                    <rect width={(c.mse / maxMse) * 38} height={8} y={3} rx={2} fill="#888" />
                    <line x1={(meta.cv_mse / maxMse) * 38} x2={(meta.cv_mse / maxMse) * 38} y1={0} y2={14} stroke="#000" strokeWidth={1.5} />
                    <title>
                      Out-of-fold MSE {fmt(c.mse, 3)} (overall {fmt(meta.cv_mse, 3)})
                    </title>
                  </svg>
                </td>
                <td>
                  <svg width={50} height={12}>
                    {(() => {
                      let x = 0;
                      return ISSUE_ORDER.map((i) => {
                        const w = c.issue_mix[i] * 50;
                        const r = (
                          <rect key={i} x={x} width={Math.max(0, w - 1)} height={10} y={1} fill={issueColor(i)}>
                            <title>
                              {meta.issues[i]}: {(c.issue_mix[i] * 100).toFixed(0)}%
                            </title>
                          </rect>
                        );
                        x += w;
                        return r;
                      });
                    })()}
                  </svg>
                </td>
                <td className={css.num}>{(c.pct_popular * 100).toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={ui.caption}>
        Labels name the two features that most set a cluster apart (dark bar = above average, light = below). Rating CI axis spans 1–7; MSE tick = overall {fmt(meta.cv_mse, 3)}.
        Issue colors as in the map legend. Click a row to select its videos; hover to outline it on the map. Clusters were fit on all 1,200 videos.
      </div>
    </Panel>
  );
}
