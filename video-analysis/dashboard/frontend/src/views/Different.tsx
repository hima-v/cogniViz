import * as d3 from "d3";
import { useEffect, useMemo, useState } from "react";
import { postCompare } from "../api";
import { Panel, SourceLine, ui } from "../components/ui";
import { accountLabel, fmt } from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import type { CategoricalCompare, CompareResult, NumericCompare, RatingTarget } from "../types";
import { X_ATTRS } from "./Attributes";
import css from "./Different.module.css";

const G_MAX = 1.5;
const SOURCE_TAG: Record<string, string> = {
  authors_ratings: "authors' ratings",
  authors_meta: "authors' metadata",
  authors_features: "authors' features",
  our_analysis: "our residuals",
};
const RATING_KEYS: Record<string, RatingTarget> = {
  msv_m: "overall",
  dim_emotional_arousal_m: "arousal",
  dim_dramatic_impact_m: "dramatic",
  dim_novelty_m: "novelty",
};

export function Different() {
  const st = useAppState();
  const dispatch = useDispatch();
  const { filtered, selected, filteredIds } = useData();
  const [res, setRes] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pinned = useMemo(() => (st.pinnedGroupA ? st.pinnedGroupA.filter((id) => filteredIds.has(id)) : null), [st.pinnedGroupA, filteredIds]);
  const ids = pinned ?? selected.map((v) => v.id);
  const ids2 = pinned ? selected.map((v) => v.id) : null;
  const ready = ids.length > 0 && (!pinned || (ids2 && ids2.length > 0));
  const key = ready ? `${ids.join(",")}|${ids2?.join(",") ?? ""}|${filtered.length}` : "";

  useEffect(() => {
    if (!ready) {
      setRes(null);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      postCompare(ids, ids2 ? { ids2 } : { pool: filtered.map((v) => v.id) }, ac.signal)
        .then((r) => {
          setRes(r);
          setErr(null);
        })
        .catch((e: Error) => e.name !== "AbortError" && setErr(e.message))
        .finally(() => setLoading(false));
    }, 120);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // key captures ids, ids2 and the pool
  }, [key]);

  const aName = pinned ? "Group A" : "Selection";
  const bName = pinned ? "group B (current selection)" : "the rest of the shown videos";
  const openAttr = (k: string) => {
    if (RATING_KEYS[k]) dispatch({ type: "set", patch: { ratingTarget: RATING_KEYS[k], v3Mode: "issue" } });
    else if (X_ATTRS.includes(k)) dispatch({ type: "set", patch: { xAttribute: k, v3Mode: "scatter" } });
    dispatch({ type: "tab", tab: "attributes", pin: true });
  };

  let body;
  if (!ready) {
    body = (
      <div className={ui.empty}>
        {pinned
          ? `Group A is pinned (${pinned.length} videos). Now lasso or brush a second group B to compare A vs B.`
          : "Select videos (lasso in the map, brush in the prediction plot, or click a cluster row) to see how they differ from the rest."}
      </div>
    );
  } else if (err) {
    body = <div className={ui.empty}>Comparison failed: {err}</div>;
  } else if (!res) {
    body = <div className={ui.empty}>Comparing…</div>;
  } else {
    body = <Results res={res} openAttr={openAttr} aLabel={pinned ? "group A" : "selection"} bLabel={pinned ? "group B" : "rest"} />;
  }

  return (
    <Panel
      title={
        <>
          What's different here?{" "}
          {res && ready && (
            <span className={css.sub}>
              {aName} (n = {res.n_a}) vs {bName} (n = {res.n_b}){loading ? " · updating…" : ""}
            </span>
          )}
        </>
      }
      controls={
        pinned ? (
          <button className={ui.btn} onClick={() => dispatch({ type: "unpinA" })}>
            Unpin group A
          </button>
        ) : (
          <button className={ui.btn} disabled={!selected.length} onClick={() => dispatch({ type: "pinA" })} title="Keep this selection as group A, then select group B">
            Pin as group A
          </button>
        )
      }
      source={
        <SourceLine
          parts={[
            { id: "authors_ratings", text: "per row: authors' ratings, metadata or features" },
            { id: "our_analysis", text: "our residuals and bootstrap statistics" },
          ]}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className={css.caption}>
          Many attributes are compared at once. Treat large differences as leads to check, not findings. Effect size = Hedges' g with a 1,000-resample
          bootstrap 95% CI; imputed and missing values are left out and counted.
        </div>
        {res?.small_group && ready && <div className={css.small}>Small group: differences may be noise (a group has fewer than 15 videos).</div>}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{body}</div>
      </div>
    </Panel>
  );
}

function Results({ res, openAttr, aLabel, bLabel }: { res: CompareResult; openAttr: (k: string) => void; aLabel: string; bLabel: string }) {
  return (
    <div className={`${css.cols} ${res.small_group ? css.gray : ""}`}>
      <div>
        <div className={css.stickyHead}>
          <div className={css.sectionHead}>
            <span>Numeric attributes (sorted by |g|)</span>
          </div>
          <AxisRow aLabel={aLabel} bLabel={bLabel} />
        </div>
        {res.numeric.map((r) => (
          <NumRow key={r.key} r={r} onClick={() => openAttr(r.key)} />
        ))}
      </div>
      <div>
        <div className={css.sectionHead}>
          <span>Categories (difference in share, percentage points)</span>
        </div>
        {res.categorical.map((c) => (
          <CatRow key={c.key} c={c} />
        ))}
      </div>
    </div>
  );
}

const BAR_W = 180;
const PAD = 14; // room for the end tick labels, shared by the axis and the bars so both use the same x positions
const gx = d3.scaleLinear().domain([-G_MAX, G_MAX]).range([0, BAR_W]).clamp(true);

function AxisRow({ aLabel, bLabel }: { aLabel: string; bLabel: string }) {
  return (
    <div className={`${css.row} ${css.axisRow}`} aria-hidden="true">
      <span />
      <svg width={BAR_W + 2 * PAD} height={42}>
        <g transform={`translate(${PAD},0)`}>
          {[-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((t) => (
            <g key={t} transform={`translate(${gx(t)},0)`}>
              <line y1={12} y2={16} stroke="#999" />
              <text y={9} fontSize={9} textAnchor="middle" fill="#666">
                {fmt(t, 1)}
              </text>
            </g>
          ))}
          <text x={BAR_W / 2} y={28} fontSize={9.5} textAnchor="middle" fill="#333">
            Difference from the {bLabel === "rest" ? "rest" : "group B"} (Hedges' g)
          </text>
          <text x={0} y={39} fontSize={8.5} fill="#888">
            ← lower in {aLabel}
          </text>
          <text x={BAR_W} y={39} fontSize={8.5} fill="#888" textAnchor="end">
            higher →
          </text>
        </g>
      </svg>
      <svg width={100} height={42}>
        <circle cx={9} cy={13} r={3} fill="#111" />
        <text x={16} y={16} fontSize={9.5} fill="#444">
          {aLabel} mean
        </text>
        <circle cx={9} cy={28} r={3.5} fill="#fff" stroke="#333" />
        <text x={16} y={31} fontSize={9.5} fill="#444">
          {bLabel} mean
        </text>
      </svg>
      <span />
    </div>
  );
}

function NumRow({ r, onClick }: { r: NumericCompare; onClick: () => void }) {
  const has = r.g != null;
  const g = r.g ?? 0;
  const lo = r.scale_min ?? 0;
  const hi = r.scale_max ?? 1;
  const mx = d3.scaleLinear().domain([lo, hi]).range([0, 90]).clamp(true);
  const miss = r.missing_a + r.missing_b;
  return (
    <button className={css.row} onClick={onClick} title="Open in Attributes">
      <span className={css.name}>
        {r.label}
        <span className={css.tag}>{SOURCE_TAG[r.source] ?? r.source}</span>
      </span>
      <svg width={BAR_W + 2 * PAD} height={16}>
        <g transform={`translate(${PAD},0)`}>
          <line x1={gx(0)} x2={gx(0)} y1={0} y2={16} stroke="#bbb" />
          {has && (
            <>
              <rect x={Math.min(gx(0), gx(g))} width={Math.abs(gx(g) - gx(0))} y={4} height={8} rx={2} fill="#555" />
              <line x1={gx(r.g_lo ?? g)} x2={gx(r.g_hi ?? g)} y1={8} y2={8} stroke="#000" strokeWidth={1.2} />
              <line x1={gx(r.g_lo ?? g)} x2={gx(r.g_lo ?? g)} y1={5} y2={11} stroke="#000" />
              <line x1={gx(r.g_hi ?? g)} x2={gx(r.g_hi ?? g)} y1={5} y2={11} stroke="#000" />
            </>
          )}
        </g>
      </svg>
      <svg width={100} height={16} aria-label="Group means on the attribute's own scale">
        <g transform="translate(5,0)">
          <line x1={0} x2={90} y1={8} y2={8} stroke="#ddd" />
          {r.mean_b != null && <circle cx={mx(r.mean_b)} cy={8} r={3.5} fill="#fff" stroke="#333" />}
          {r.mean_a != null && <circle cx={mx(r.mean_a)} cy={8} r={3} fill="#111" />}
        </g>
      </svg>
      <span className={css.num}>
        g {fmt(r.g)} [{fmt(r.g_lo)}, {fmt(r.g_hi)}] · means {fmtVal(r.mean_a)} vs {fmtVal(r.mean_b)} · <span style={{ whiteSpace: "nowrap" }}>n {r.n_a}/{r.n_b}</span>
        {miss > 0 && <span className={ui.warn}> · {miss} missing</span>}
      </span>
    </button>
  );
}

const fmtVal = (x: number | null) => (x == null ? "–" : Math.abs(x) >= 100 ? d3.format(",.0f")(x) : Math.abs(x) >= 10 ? fmt(x, 1) : fmt(x, 2));

function catLabel(key: string, c: string, issues: Record<string, string>) {
  if (key === "issue") return issues[c] ?? c;
  if (key === "account_type") return accountLabel(c);
  if (c === "True") return "yes";
  if (c === "False") return "no";
  return c;
}

const PP_W = 120;
const ppx = d3.scaleLinear().domain([-50, 50]).range([0, PP_W]).clamp(true);

function CatRow({ c }: { c: CategoricalCompare }) {
  const { meta } = useData();
  const rows = c.categories.filter((x) => !(c.categories.length === 2 && x.category === "False"));
  return (
    <div className={css.cat}>
      <div className={css.name}>
        {c.label}
        <span className={css.tag}>{SOURCE_TAG[c.source] ?? c.source}</span>
        {c.top && (
          <span className={css.top}>
            largest: {catLabel(c.key, c.top.category, meta.issues)} {c.top.diff_pp > 0 ? "+" : "−"}
            {Math.abs(c.top.diff_pp).toFixed(0)} pp
          </span>
        )}
      </div>
      {rows.map((x) => (
        <div key={x.category} className={css.catRow}>
          <span className={css.catName}>{catLabel(c.key, x.category, meta.issues)}</span>
          <svg width={PP_W + 6} height={12}>
            <g transform="translate(3,0)">
              <line x1={ppx(0)} x2={ppx(0)} y1={0} y2={12} stroke="#bbb" />
              <rect x={Math.min(ppx(0), ppx(x.diff_pp))} width={Math.abs(ppx(x.diff_pp) - ppx(0))} y={2} height={8} rx={2} fill="#555" />
            </g>
          </svg>
          <span className={css.num}>
            {(x.share_a * 100).toFixed(0)}% vs {(x.share_b * 100).toFixed(0)}% ({x.diff_pp > 0 ? "+" : ""}
            {x.diff_pp.toFixed(0)} pp)
          </span>
        </div>
      ))}
    </div>
  );
}
