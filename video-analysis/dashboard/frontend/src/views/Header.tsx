import * as d3 from "d3";
import { ui } from "../components/ui";
import { ISSUE_ORDER, fmt, issueColor } from "../encodings";
import { DEFAULT_FILTERS, useAppState, useData, useDispatch } from "../state";
import type { Filters } from "../types";
import css from "./Header.module.css";

function MultiCheck({ label, options, value, onChange }: { label: string; options: { key: string; label: string; color?: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const summary = value.length === 0 ? "all" : value.length === 1 ? options.find((o) => o.key === value[0])?.label : `${value.length} chosen`;
  return (
    <details className={css.multi}>
      <summary className={ui.select}>
        {label}: {summary}
      </summary>
      <div className={css.menu}>
        {options.map((o) => (
          <label key={o.key} className={ui.label}>
            <input
              type="checkbox"
              checked={value.includes(o.key)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.key] : value.filter((x) => x !== o.key))}
            />
            {o.color && <span className={ui.swatch} style={{ background: o.color }} />}
            {o.label}
          </label>
        ))}
        {value.length > 0 && (
          <button className={ui.btn} onClick={() => onChange([])}>
            Show all
          </button>
        )}
      </div>
    </details>
  );
}

export function Header() {
  const st = useAppState();
  const dispatch = useDispatch();
  const { videos, filtered, selected, hasSelection, meta } = useData();
  const f = st.filters;
  const setF = (patch: Partial<Filters>) => dispatch({ type: "filters", patch });
  const mse = (vs: typeof filtered) => (vs.length ? d3.mean(vs, (v) => v.sq_err)! : NaN);
  const filtersActive = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <header className={css.header}>
      <div className={css.title}>
        <b>PMSV explorer</b>
        <span className={ui.muted}> · sensation ratings of 1,200 Instagram Reels</span>
      </div>
      <div className={css.stats}>
        <span>
          <b>{filtered.length}</b> of {videos.length} videos shown
          {hasSelection && (
            <>
              {" · "}
              <b>{selected.length}</b> selected
            </>
          )}
          {st.pinnedGroupA && <> · group A pinned ({st.pinnedGroupA.length})</>}
        </span>
        <span title="Mean squared error of out-of-fold predictions; lower is better">
          Model error (CV MSE): all {fmt(meta.cv_mse, 3)}
          {filtersActive && <> · shown {fmt(mse(filtered), 3)}</>}
          {hasSelection && (
            <>
              {" · "}
              <b>selection {fmt(mse(selected), 3)}</b> (n = {selected.length})
            </>
          )}
        </span>
      </div>
      <div className={css.filters}>
        <MultiCheck
          label="Issue"
          options={ISSUE_ORDER.map((i) => ({ key: i, label: meta.issues[i], color: issueColor(i) }))}
          value={f.issues}
          onChange={(issues) => setF({ issues })}
        />
        <select className={ui.select} value={f.tagMode} onChange={(e) => setF({ tagMode: e.target.value as Filters["tagMode"] })} aria-label="Issue filter mode">
          <option value="sampled">by sampled issue</option>
          <option value="any">by any tag</option>
        </select>
        <MultiCheck
          label="Account"
          options={[
            { key: "popular", label: "Popular" },
            { key: "unpopular", label: "Ordinary" },
          ]}
          value={f.accountTypes}
          onChange={(accountTypes) => setF({ accountTypes })}
        />
        <MultiCheck
          label="Aspect"
          options={["vertical", "square", "landscape", "unknown"].map((a) => ({ key: a, label: a }))}
          value={f.aspects}
          onChange={(aspects) => setF({ aspects })}
        />
        <select className={ui.select} value={f.speech} onChange={(e) => setF({ speech: e.target.value as Filters["speech"] })} aria-label="Speech filter">
          <option value="all">Speech: any</option>
          <option value="yes">Speech detected</option>
          <option value="no">No speech</option>
        </select>
        <label className={ui.label} title={`${meta.null_roles.no_face.n} no-face and ${meta.null_roles.silent.n} silent videos have imputed feature values`}>
          <input type="checkbox" checked={f.hideImputed} onChange={(e) => setF({ hideImputed: e.target.checked })} />
          Hide imputed
        </label>
        <label className={ui.label}>
          <input type="checkbox" checked={f.hideNoFace} onChange={(e) => setF({ hideNoFace: e.target.checked })} />
          Hide no-face
        </label>
        <button className={ui.btn} onClick={() => dispatch({ type: "reset" })}>
          Reset
        </button>
        <button className={ui.btn} onClick={() => dispatch({ type: "provenance", open: "all" })}>
          Data sources
        </button>
      </div>
    </header>
  );
}
