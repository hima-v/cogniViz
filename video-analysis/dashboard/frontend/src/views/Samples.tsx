import { useEffect, useMemo, useRef, useState } from "react";
import { thumbUrl } from "../api";
import { Panel, SourceLine, ui } from "../components/ui";
import { ISSUE_ORDER, RATING_TARGETS, fmt, issueColor, ratingColor, ratingOf } from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import type { SampleSort, Video } from "../types";
import css from "./Samples.module.css";

const PAGE = 60;
const SORTS: Record<SampleSort, { label: string; get: (v: Video) => number }> = {
  rating: { label: "rating (high to low)", get: (v) => v.rating },
  residual: { label: "model error (most over-predicted first)", get: (v) => v.residual },
  rater_sd: { label: "rater disagreement (high to low)", get: (v) => v.rater_sd },
  duration: { label: "length (long to short)", get: (v) => v.duration },
};

export function Samples() {
  const st = useAppState();
  const dispatch = useDispatch();
  const { filtered, selected, hasSelection, meta } = useData();
  const [limit, setLimit] = useState(PAGE);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const base = hasSelection ? selected : filtered;
  const sorted = useMemo(() => {
    const g = SORTS[st.sampleSort].get;
    const target = st.sampleSort === "rating" ? (v: Video) => ratingOf(v, st.ratingTarget) : g;
    return [...base].sort((a, b) => target(b) - target(a));
  }, [base, st.sampleSort, st.ratingTarget]);

  useEffect(() => {
    setLimit(PAGE);
    scroller.current?.scrollTo({ left: 0 });
  }, [sorted]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((l) => l + PAGE), { root: scroller.current, rootMargin: "0px 400px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, sorted]);

  const local = base.filter((v) => v.has_video).length;
  return (
    <Panel
      title={
        <>
          Sample videos{" "}
          <span className={css.sub}>
            Showing {Math.min(limit, sorted.length)} of {sorted.length} {hasSelection ? "selected" : "shown"} videos, sorted by {SORTS[st.sampleSort].label}
          </span>
        </>
      }
      controls={
        <label className={ui.label}>
          Sort by
          <select className={ui.select} value={st.sampleSort} onChange={(e) => dispatch({ type: "set", patch: { sampleSort: e.target.value as SampleSort } })}>
            {(Object.keys(SORTS) as SampleSort[]).map((s) => (
              <option key={s} value={s}>
                {SORTS[s].label}
              </option>
            ))}
          </select>
        </label>
      }
      source={
        <SourceLine
          parts={[
            { id: "our_thumbnails", text: "our thumbnails from raw videos" },
            { id: "authors_ratings", text: "authors' ratings" },
          ]}
          coverage={`${local} of ${base.length} have local video files`}
        />
      }
    >
      <div className={css.body}>
        <div className={`${ui.legend} ${css.legend}`}>
          <span>Bar under each video = issue:</span>
          {ISSUE_ORDER.map((i) => (
            <span key={i} className={ui.legendItem}>
              <span className={css.legendBar} style={{ background: issueColor(i) }} />
              {meta.issues[i]}
            </span>
          ))}
        </div>
        <div ref={scroller} className={css.row}>
          {sorted.slice(0, limit).map((v) => (
            <Tile key={v.id} v={v} hovered={st.hoveredId === v.id} focused={st.focusedId === v.id} issue={meta.issues[v.issue]} />
          ))}
          {limit < sorted.length && <div ref={sentinel} className={css.sentinel} />}
          {sorted.length === 0 && <div className={ui.empty}>No videos match the filters.</div>}
        </div>
      </div>
    </Panel>
  );
}

function Tile({ v, hovered, focused, issue }: { v: Video; hovered: boolean; focused: boolean; issue: string }) {
  const st = useAppState();
  const dispatch = useDispatch();
  const [pos, setPos] = useState<25 | 50 | 75>(50);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const r = ratingOf(v, st.ratingTarget);
  const startCycle = () => {
    dispatch({ type: "hover", id: v.id });
    if (!v.has_video) return;
    const seq: (25 | 50 | 75)[] = [25, 50, 75];
    let i = 0;
    setPos(seq[0]);
    timer.current = window.setInterval(() => {
      i = (i + 1) % 3;
      setPos(seq[i]);
    }, 650);
  };
  const stopCycle = () => {
    dispatch({ type: "hover", id: null });
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setPos(50);
  };
  useEffect(() => () => void (timer.current && window.clearInterval(timer.current)), []);
  return (
    <button
      className={`${css.tile} ${hovered ? css.hovered : ""} ${focused ? css.focused : ""}`}
      onMouseEnter={startCycle}
      onMouseLeave={stopCycle}
      onFocus={() => dispatch({ type: "hover", id: v.id })}
      onClick={() => dispatch({ type: "focus", id: v.id })}
      title={`${issue} · ${RATING_TARGETS[st.ratingTarget].label} ${fmt(r)} ± ${fmt(v.ci95)} · ${fmt(v.duration, 0)} s`}
    >
      <div className={css.frame}>
        {v.has_video && !failed ? (
          <img src={thumbUrl(v.id, pos)} alt={`Frame at ${pos}% of video ${v.id}`} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <div className={css.placeholder}>{v.has_video ? "No thumbnail yet (run thumbs.py)" : "Not local (batch 7 or 8)"}</div>
        )}
        <span className={css.badge} style={{ background: ratingColor(r), color: r > 4.6 ? "#111" : "#fff" }}>
          {fmt(r, 1)}
        </span>
        <span className={css.icons}>
          {v.no_face && <span title="No faces detected (face time imputed)">no face</span>}
          {v.silent && <span title="No audio track (audio features imputed)">silent</span>}
          {!v.has_speech && <span title="No speech detected">no speech</span>}
        </span>
      </div>
      <div className={css.strip} style={{ background: issueColor(v.issue) }} title={issue} />
    </button>
  );
}
