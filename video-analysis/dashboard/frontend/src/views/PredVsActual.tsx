import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { ColorLegend } from "../components/Legend";
import { Panel, SourceLine, Toggle, Tooltip, ui, useSize } from "../components/ui";
import { VideoTip } from "../components/VideoTip";
import { SELECT_DIM, residualColor } from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import type { Video } from "../types";

const M = { l: 38, r: 8, t: 4, b: 30 };

export function PredVsActual() {
  const st = useAppState();
  const dispatch = useDispatch();
  const { filtered, byId, hasSelection, selected } = useData();
  const [boxRef, size] = useSize<HTMLDivElement>();
  const brushRef = useRef<SVGGElement>(null);
  const [tip, setTip] = useState<{ v: Video; x: number; y: number } | null>(null);
  const selectedSet = useMemo(() => new Set(selected.map((v) => v.id)), [selected]);

  const side = Math.max(40, Math.min(size.width - M.l - M.r, size.height - M.t - M.b));
  const x = useMemo(() => d3.scaleLinear().domain([1, 7]).range([0, side]), [side]);
  const y = useMemo(() => d3.scaleLinear().domain([1, 7]).range([side, 0]), [side]);
  const ox = M.l + Math.max(0, (size.width - M.l - M.r - side) / 2);

  const pts = useMemo(() => filtered.map((v) => [x(v.rating), y(v.pred)] as [number, number]), [filtered, x, y]);
  const delaunay = useMemo(() => d3.Delaunay.from(pts), [pts]);
  const nearest = (px: number, py: number) => {
    if (!pts.length) return null;
    const i = delaunay.find(px, py);
    return Math.hypot(pts[i][0] - px, pts[i][1] - py) < 8 ? filtered[i] : null;
  };
  const nearestRef = useRef(nearest);
  nearestRef.current = nearest;

  useEffect(() => {
    if (!brushRef.current || side < 50) return;
    const g = d3.select(brushRef.current);
    const brush = d3
      .brush()
      .keyModifiers(false) // shift means "add to selection" here, not "lock axis"
      .extent([
        [0, 0],
        [side, side],
      ])
      .on("end", (ev: d3.D3BrushEvent<unknown>) => {
        if (!ev.sourceEvent) return;
        const s = ev.selection as [[number, number], [number, number]] | null;
        if (!s) {
          const [px, py] = d3.pointer(ev.sourceEvent, brushRef.current);
          const v = nearestRef.current(px, py);
          if (v) dispatch({ type: "focus", id: v.id });
          return;
        }
        const [[x0, y0], [x1, y1]] = s;
        const ids = filtered.filter((_, i) => pts[i][0] >= x0 && pts[i][0] <= x1 && pts[i][1] >= y0 && pts[i][1] <= y1).map((v) => v.id);
        dispatch({ type: "select", ids, add: (ev.sourceEvent as MouseEvent).shiftKey });
        g.call(brush.move, null);
      });
    g.call(brush);
    return () => {
      g.on(".brush", null);
    };
  }, [side, filtered, pts, dispatch]);

  const hovered = st.hoveredId ? byId.get(st.hoveredId) : undefined;
  const focused = st.focusedId ? byId.get(st.focusedId) : undefined;
  const ordered = hasSelection ? [...filtered.filter((v) => !selectedSet.has(v.id)), ...selected] : filtered;
  const ticks = [1, 2, 3, 4, 5, 6, 7];

  return (
    <Panel
      title="Out-of-fold predictions (10×10 cross-validation)"
      controls={
        <Toggle on={st.showCI} onClick={() => dispatch({ type: "set", patch: { showCI: !st.showCI } })} title="95% CI of the rater mean">
          95% CI bars
        </Toggle>
      }
      source={<SourceLine parts={[{ id: "authors_ratings", text: "authors' ratings" }, { id: "our_analysis", text: "our out-of-fold predictions" }]} />}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <ColorLegend colorBy="residual" showShapes={false} />
        <div ref={boxRef} style={{ flex: 1, minHeight: 0 }}>
          <svg
            width={size.width}
            height={size.height}
            onMouseMove={(e) => {
              const r = brushRef.current?.getBoundingClientRect();
              if (!r) return;
              const v = nearest(e.clientX - r.left, e.clientY - r.top);
              dispatch({ type: "hover", id: v?.id ?? null });
              setTip(v ? { v, x: e.clientX, y: e.clientY } : null);
            }}
            onMouseLeave={() => {
              dispatch({ type: "hover", id: null });
              setTip(null);
            }}
            role="img"
            aria-label="Predicted versus actual rating; drag a rectangle to select"
          >
            <g transform={`translate(${ox},${M.t})`}>
              <g className={ui.axis}>
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={x(t)} x2={x(t)} y1={0} y2={side} stroke="#f0f0f0" />
                    <line x1={0} x2={side} y1={y(t)} y2={y(t)} stroke="#f0f0f0" />
                    <text x={x(t)} y={side + 11} textAnchor="middle">
                      {t}
                    </text>
                    <text x={-5} y={y(t) + 3} textAnchor="end">
                      {t}
                    </text>
                  </g>
                ))}
              </g>
              <text className={ui.axisLabel} x={side / 2} y={side + 25} textAnchor="middle">
                Actual sensation rating (rater mean, 1–7)
              </text>
              <text className={ui.axisLabel} transform={`translate(${-28},${side / 2}) rotate(-90)`} textAnchor="middle">
                Predicted rating (1–7)
              </text>
              <line x1={x(1)} y1={y(1)} x2={x(7)} y2={y(7)} stroke="#888" strokeDasharray="4 3" />
              <text x={x(6.9)} y={y(6.9) + 12} fontSize={9.5} fill="#777" textAnchor="end">
                perfect prediction
              </text>
              <g pointerEvents="none">
                {st.showCI &&
                  ordered.map((v) => (
                    <line
                      key={v.id}
                      x1={x(Math.max(1, v.rating - v.ci95))}
                      x2={x(Math.min(7, v.rating + v.ci95))}
                      y1={y(v.pred)}
                      y2={y(v.pred)}
                      stroke={hasSelection && !selectedSet.has(v.id) ? SELECT_DIM : "#999"}
                      strokeOpacity={hasSelection && !selectedSet.has(v.id) ? 0.2 : 0.35}
                    />
                  ))}
                {ordered.map((v) => {
                  const dim = hasSelection && !selectedSet.has(v.id);
                  return (
                    <circle
                      key={v.id}
                      cx={x(v.rating)}
                      cy={y(v.pred)}
                      r={2.6}
                      fill={dim ? SELECT_DIM : residualColor(v.residual)}
                      fillOpacity={dim ? 0.2 : 0.9}
                      stroke={dim ? "none" : "rgba(0,0,0,0.35)"}
                      strokeWidth={0.5}
                    />
                  );
                })}
                {focused && filtered.includes(focused) && <circle cx={x(focused.rating)} cy={y(focused.pred)} r={7} fill="none" stroke="#000" strokeWidth={2} />}
                {hovered && filtered.includes(hovered) && <circle cx={x(hovered.rating)} cy={y(hovered.pred)} r={5.5} fill="none" stroke="#111" strokeWidth={2} />}
              </g>
              <g ref={brushRef} />
            </g>
          </svg>
          {tip && (
            <Tooltip x={tip.x} y={tip.y}>
              <VideoTip v={tip.v} />
            </Tooltip>
          )}
        </div>
        <div className={ui.caption}>
          Each prediction comes from models that never saw that video (mean of 10 repeats). Above the dashed line = over-predicted. Drag to select.
        </div>
      </div>
    </Panel>
  );
}
