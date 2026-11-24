import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { ColorLegend } from "../components/Legend";
import { Panel, SourceLine, Toggle, Tooltip, ui, useSize } from "../components/ui";
import { VideoTip } from "../components/VideoTip";
import { COLOR_BY_LABELS, SELECT_DIM, accountSymbol, clusterColor, colorFor, issueColor } from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import type { ColorBy, Method, Video } from "../types";

const METHOD_LABEL: Record<Method, string> = { tsne: "t-SNE", umap: "UMAP", pca: "PCA" };
const PAD = 14;

export function Projection() {
  const st = useAppState();
  const dispatch = useDispatch();
  const { filtered, meta, byId, hasSelection, selected } = useData();
  const [boxRef, size] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const prevMethod = useRef(st.projection);
  const [tip, setTip] = useState<{ v: Video; x: number; y: number } | null>(null);
  const [lasso, setLasso] = useState<[number, number][] | null>(null);
  const method = st.projection;

  const { sx, sy } = useMemo(() => {
    const side = Math.max(10, Math.min(size.width, size.height) - 2 * PAD);
    const ox = (size.width - side) / 2;
    const oy = (size.height - side) / 2;
    return {
      sx: d3.scaleLinear().domain([0, 1]).range([ox, ox + side]),
      sy: d3.scaleLinear().domain([0, 1]).range([oy + side, oy]),
    };
  }, [size]);

  const pts = useMemo(() => filtered.map((v) => [sx(v.xy[method][0]), sy(v.xy[method][1])] as [number, number]), [filtered, method, sx, sy]);
  const delaunay = useMemo(() => d3.Delaunay.from(pts), [pts]);
  const selectedSet = useMemo(() => new Set(selected.map((v) => v.id)), [selected]);

  // ---- points (d3-managed for animated method switches)
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (!size.width) return;
    const animate = prevMethod.current !== method;
    prevMethod.current = method;
    const g = svg.select<SVGGElement>("g.points");
    const sel = g
      .selectAll<SVGPathElement, Video>("path")
      .data(filtered, (d) => d.id)
      .join((enter) => enter.append("path").attr("transform", (d) => `translate(${sx(d.xy[method][0])},${sy(d.xy[method][1])})`));
    const t = animate ? sel.transition().duration(700) : sel;
    (t as d3.Selection<SVGPathElement, Video, SVGGElement, unknown>).attr(
      "transform",
      (d) => `translate(${sx(d.xy[method][0])},${sy(d.xy[method][1])})`,
    );
  }, [filtered, method, sx, sy, size.width]);

  useEffect(() => {
    const g = d3.select(svgRef.current).select<SVGGElement>("g.points");
    const sym = (v: Video) => d3.symbol(accountSymbol(v.account_type), 30)() ?? "";
    g.selectAll<SVGPathElement, Video>("path")
      .attr("d", sym)
      .attr("fill", (d) => (hasSelection && !selectedSet.has(d.id) ? SELECT_DIM : colorFor(d, st.colorBy, st.k, st.ratingTarget)))
      .attr("fill-opacity", (d) => (hasSelection && !selectedSet.has(d.id) ? 0.2 : 0.9))
      .attr("stroke", (d) => (hasSelection && !selectedSet.has(d.id) ? "none" : "rgba(0,0,0,0.35)"))
      .attr("stroke-width", 0.5);
    // selected points on top
    if (hasSelection) g.selectAll<SVGPathElement, Video>("path").filter((d) => selectedSet.has(d.id)).raise();
  }, [filtered, st.colorBy, st.k, st.ratingTarget, hasSelection, selectedSet, size.width, method]);

  // ---- density contours of the filtered set
  const contours = useMemo(() => {
    if (!st.showContours || !size.width || pts.length < 10) return [];
    return d3
      .contourDensity<[number, number]>()
      .x((d) => d[0])
      .y((d) => d[1])
      .size([size.width, size.height])
      .bandwidth(16)
      .thresholds(7)(pts);
  }, [pts, st.showContours, size]);

  // ---- group contour on legend / cluster-row hover
  const group = st.hoverGroup;
  const groupContour = useMemo(() => {
    if (!group || !size.width) return null;
    const members = filtered.filter((v) => (group.kind === "issue" ? v.issue === group.value : v.cluster[String(st.k)] === group.value));
    if (members.length < 5) return null;
    const gp = members.map((v) => [sx(v.xy[method][0]), sy(v.xy[method][1])] as [number, number]);
    const cs = d3
      .contourDensity<[number, number]>()
      .x((d) => d[0])
      .y((d) => d[1])
      .size([size.width, size.height])
      .bandwidth(16)
      .thresholds(4)(gp);
    const color = group.kind === "issue" ? issueColor(String(group.value)) : clusterColor(Number(group.value));
    return { cs, color };
  }, [group, filtered, method, sx, sy, size, st.k]);

  // ---- cluster labels at medoids with a collision nudge
  const labels = useMemo(() => {
    if (!st.showLabels || !size.width) return [];
    const rows = meta.clusters[String(st.k)].clusters;
    const boxes = rows.map((c) => {
      const text = c.label + (c.diffuse[method] ? " (spread out)" : "");
      const w = text.length * 5.6 + 18;
      return { c, text, x: sx(c.medoid[method][0]), y: sy(c.medoid[method][1]), w, h: 15 };
    });
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
          const oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
          if (ox > 0 && oy > 0) {
            const push = oy / 2 + 0.5;
            if (a.y <= b.y) {
              a.y -= push;
              b.y += push;
            } else {
              a.y += push;
              b.y -= push;
            }
            moved = true;
          }
        }
      if (!moved) break;
    }
    for (const b of boxes) {
      b.x = Math.max(b.w / 2 + 2, Math.min(size.width - b.w / 2 - 2, b.x));
      b.y = Math.max(10, Math.min(size.height - 8, b.y));
    }
    return boxes;
  }, [meta, st.k, st.showLabels, method, sx, sy, size]);

  // ---- interaction: hover via Delaunay, lasso, click to focus
  const local = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };
  const nearest = (p: [number, number]) => {
    if (!pts.length) return null;
    const i = delaunay.find(p[0], p[1]);
    const d = Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]);
    return d < 10 ? filtered[i] : null;
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    setLasso([local(e)]);
    setTip(null);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (lasso) {
      setLasso([...lasso, p]);
      return;
    }
    const v = nearest(p);
    dispatch({ type: "hover", id: v?.id ?? null });
    setTip(v ? { v, x: e.clientX, y: e.clientY } : null);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!lasso) return;
    const poly = lasso;
    setLasso(null);
    const [x0, x1] = d3.extent(poly, (p) => p[0]) as [number, number];
    const [y0, y1] = d3.extent(poly, (p) => p[1]) as [number, number];
    if (poly.length < 4 || (x1 - x0 < 5 && y1 - y0 < 5)) {
      const v = nearest(local(e));
      if (v) dispatch({ type: "focus", id: v.id });
      return;
    }
    const ids = filtered.filter((_, i) => d3.polygonContains(poly, pts[i])).map((v) => v.id);
    dispatch({ type: "select", ids, add: e.shiftKey });
  };

  const hovered = st.hoveredId ? byId.get(st.hoveredId) : undefined;
  const focused = st.focusedId ? byId.get(st.focusedId) : undefined;
  const params = meta.projection_params[method];
  const paramText = Object.entries(params)
    .filter(([k]) => k !== "method")
    .map(([k, v]) => `${k.replace("_", " ")} ${Array.isArray(v) ? v.map((x) => `${(x * 100).toFixed(0)}%`).join(" / ") : v}`)
    .join(", ");
  const geo = d3.geoPath();

  const ring = (v: Video | undefined, color: string, r: number) =>
    v && filtered.includes(v) ? <circle cx={sx(v.xy[method][0])} cy={sy(v.xy[method][1])} r={r} fill="none" stroke={color} strokeWidth={2} /> : null;

  return (
    <Panel
      title="Map of videos by audio-visual features"
      controls={
        <>
          <select className={ui.select} value={method} onChange={(e) => dispatch({ type: "set", patch: { projection: e.target.value as Method } })} aria-label="Projection method">
            {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
          <label className={ui.label}>
            Color by
            <select className={ui.select} value={st.colorBy} onChange={(e) => dispatch({ type: "set", patch: { colorBy: e.target.value as ColorBy } })}>
              {(Object.keys(COLOR_BY_LABELS) as ColorBy[]).map((c) => (
                <option key={c} value={c}>
                  {COLOR_BY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <Toggle on={st.showContours} onClick={() => dispatch({ type: "set", patch: { showContours: !st.showContours } })}>
            Density
          </Toggle>
          <Toggle on={st.showLabels} onClick={() => dispatch({ type: "set", patch: { showLabels: !st.showLabels } })}>
            Cluster labels
          </Toggle>
        </>
      }
      source={<SourceLine parts={[{ id: "authors_features", text: "authors' features" }, { id: "our_analysis", text: "our projection and clusters" }]} />}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <ColorLegend colorBy={st.colorBy} />
        <div ref={boxRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <svg
            ref={svgRef}
            width={size.width}
            height={size.height}
            style={{ display: "block", cursor: "crosshair", touchAction: "none" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => {
              dispatch({ type: "hover", id: null });
              setTip(null);
            }}
            role="img"
            aria-label="Projection of videos; drag to lasso-select, shift-drag to add"
          >
            <g pointerEvents="none">
              {contours.map((c, i) => (
                <path key={i} d={geo(c) ?? ""} fill="#000" fillOpacity={0.025} stroke="#bdbdbd" strokeWidth={0.7} />
              ))}
            </g>
            <g className="points" pointerEvents="none" />
            <g pointerEvents="none">
              {groupContour?.cs.map((c, i) => (
                <path key={i} d={geo(c) ?? ""} fill="none" stroke={groupContour.color} strokeWidth={i === 0 ? 2.5 : 1.2} strokeOpacity={0.9} />
              ))}
            </g>
            {ring(focused, "#000", 8)}
            {ring(hovered, "#111", 6)}
            <g pointerEvents="none">
              {labels.map((b) => (
                <g key={b.c.cluster} transform={`translate(${b.x},${b.y})`} opacity={b.c.diffuse[method] ? 0.55 : 1}>
                  <rect x={-b.w / 2} y={-8} width={b.w} height={15} rx={3} fill="#fff" fillOpacity={0.85} stroke="#ccc" strokeWidth={0.5} />
                  <rect x={-b.w / 2 + 4} y={-4} width={8} height={8} rx={1.5} fill={clusterColor(b.c.cluster)} />
                  <text x={-b.w / 2 + 15} y={3.5} fontSize={10.5} fill="#222" fontStyle={b.c.diffuse[method] ? "italic" : "normal"}>
                    {b.text}
                  </text>
                </g>
              ))}
            </g>
            {lasso && <path d={`M${lasso.map((p) => p.join(",")).join("L")}Z`} fill="rgba(0,0,0,0.05)" stroke="#333" strokeDasharray="3 2" />}
          </svg>
          {tip && (
            <Tooltip x={tip.x} y={tip.y}>
              <VideoTip v={tip.v} />
            </Tooltip>
          )}
        </div>
        <div className={ui.caption}>
          {params.method} ({paramText}) on the authors' 11 standardized features; labels: k-means (k = {st.k}) feature profiles. Axes have no
          units. Nearby points have similar audio-visual features; distances between groups are not meaningful. Drag to lasso, shift-drag to add,
          click to open a video, Esc to clear.
        </div>
      </div>
    </Panel>
  );
}
