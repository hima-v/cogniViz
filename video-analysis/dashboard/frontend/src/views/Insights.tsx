import { Panel, SourceLine, ui } from "../components/ui";
import { useAppState, useData, useDispatch } from "../state";
import css from "./Insights.module.css";

export function Insights() {
  const { insights, meta } = useData();
  const { activeInsight } = useAppState();
  const dispatch = useDispatch();
  const label = (id: string) => meta.provenance.find((p) => p.id === id)?.label ?? id;
  return (
    <Panel
      title="Findings to explore"
      scroll
      source={<SourceLine parts={[{ id: "our_analysis", text: "statistics computed by our team at build time; each card lists its sources" }]} />}
    >
      <div className={css.list}>
        {insights.map((ins) => (
          <article key={ins.id} className={`${css.card} ${activeInsight === ins.id ? css.active : ""}`}>
            <h3 className={css.title}>{ins.title}</h3>
            <p className={css.finding}>{ins.finding}</p>
            <div className={css.meta}>
              n = {ins.n.toLocaleString()} · {ins.caveat}
            </div>
            <details className={css.method}>
              <summary>Method</summary>
              {ins.method}
            </details>
            <div className={css.foot}>
              <span className={css.sources}>
                {ins.sources.map((s) => (
                  <button key={s} className={css.srcTag} onClick={() => dispatch({ type: "provenance", open: s })}>
                    {label(s)}
                  </button>
                ))}
              </span>
              <button className={`${ui.btn} ${activeInsight === ins.id ? ui.btnActive : ""}`} onClick={() => dispatch({ type: "applyInsight", insight: ins })}>
                Show in views
              </button>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
