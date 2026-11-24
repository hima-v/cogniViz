import * as d3 from "d3";
import { Panel, SourceLine, ui, useSize } from "../components/ui";
import { fmt } from "../encodings";
import { useData } from "../state";
import type { ExperimentRow } from "../types";

function plain(c: string): string {
  const fixed: Record<string, string> = {
    "paper_11 (their features)": "Authors' 11 features (incl. faces)",
    "paper_9 (no faces)": "Authors' features, faces removed",
    own_whole: "Our 9 whole-video features",
    "own_whole + log_length": "Our whole-video features + length",
    "own_whole + len": "Whole video + length (baseline)",
    own_first3: "First 3 s only",
    own_first5: "First 5 s only",
    own_eml: "Early / middle / late thirds",
  };
  if (fixed[c]) return fixed[c];
  let m = c.match(/^own_k(\d+)$/);
  if (m) return `${m[1]} time windows, in order`;
  m = c.match(/^k(\d+) (concat|shuffled|summary|late_fusion) \+ len$/);
  if (m) {
    const k = m[1];
    return {
      concat: `${k} windows in order`,
      shuffled: `${k} windows shuffled`,
      summary: `${k}-window summary stats`,
      late_fusion: `${k} windows, one model each`,
    }[m[2] as "concat"]!;
  }
  return c;
}

interface Agg {
  condition: string;
  label: string;
  mean: number;
  lo: number;
  hi: number;
  sd: number;
  seeds: number;
  k: number | null;
  kind: string;
}

function aggregate(rows: ExperimentRow[]): Agg[] {
  return d3
    .groups(rows, (r) => r.condition)
    .map(([condition, rs]) => {
      const m = condition.match(/^k(\d+) (\w+)/);
      return {
        condition,
        label: plain(condition),
        mean: d3.mean(rs, (r) => r.cv_mse)!,
        lo: d3.min(rs, (r) => r.cv_mse)!,
        hi: d3.max(rs, (r) => r.cv_mse)!,
        sd: d3.mean(rs, (r) => r.sd_across_repeats)!,
        seeds: new Set(rs.map((r) => r.seed)).size,
        k: m ? Number(m[1]) : null,
        kind: m ? m[2] : "whole",
      };
    });
}

function DotPlot({ title, rows, baseline, x, width, paired }: { title: string; rows: Agg[]; baseline: Agg | undefined; x: d3.ScaleLinear<number, number>; width: number; paired: boolean }) {
  const L = 210;
  const RH = 16;
  const H = rows.length * RH + 52;
  const y = (i: number) => 22 + i * RH + RH / 2;
  const idx = new Map(rows.map((r, i) => [r.condition, i]));
  return (
    <svg width={width} height={H} role="img" aria-label={title}>
      <text x={0} y={11} fontSize={11.5} fontWeight={700} fill="#222">
        {title}
      </text>
      <g transform={`translate(${L},0)`}>
        {x.ticks(6).map((t) => (
          <g key={t} transform={`translate(${x(t)},0)`}>
            <line y1={18} y2={H - 32} stroke="#f0f0f0" />
            <text y={H - 21} fontSize={9.5} textAnchor="middle" fill="#666">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={(x.range()[0] + x.range()[1]) / 2} y={H - 5} fontSize={10.5} textAnchor="middle" fill="#333">
          Cross-validated error (MSE), lower is better
        </text>
        {baseline && (
          <g>
            <line x1={x(baseline.mean)} x2={x(baseline.mean)} y1={16} y2={H - 32} stroke="#000" strokeDasharray="4 3" />
            <text x={x(baseline.mean) + 3} y={16} fontSize={9} fill="#333">
              baseline {fmt(baseline.mean, 3)}
            </text>
          </g>
        )}
        {paired &&
          [3, 5, 10].map((k) => {
            const a = idx.get(`k${k} concat + len`);
            const b = idx.get(`k${k} shuffled + len`);
            if (a == null || b == null) return null;
            return (
              <path
                key={k}
                d={`M${-8},${y(a)} h-6 V${y(b)} h6`}
                fill="none"
                stroke="#777"
                strokeWidth={1.2}
              />
            );
          })}
        {rows.map((r, i) => (
          <g key={r.condition}>
            <text x={-18} y={y(i) + 3.5} fontSize={10.5} textAnchor="end" fill="#333">
              {r.label}
            </text>
            {r.seeds > 1 ? (
              <line x1={x(r.lo)} x2={x(r.hi)} y1={y(i)} y2={y(i)} stroke="#000" strokeWidth={2} />
            ) : (
              <line x1={x(r.mean - r.sd)} x2={x(r.mean + r.sd)} y1={y(i)} y2={y(i)} stroke="#aaa" strokeWidth={1.5} />
            )}
            <circle cx={x(r.mean)} cy={y(i)} r={3.8} fill={r.condition === baseline?.condition ? "#fff" : "#222"} stroke="#222" />
            <text x={x(r.hi > r.mean + r.sd ? r.hi : r.mean + r.sd) + 6} y={y(i) + 3.5} fontSize={9.5} fill="#555">
              {fmt(r.mean, 3)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function Experiments() {
  const { experiments, selected, hasSelection } = useData();
  const [ref, size] = useSize<HTMLDivElement>();
  const withBins = selected.filter((v) => v.has_bins).length;
  const source = (
    <SourceLine
      parts={[{ id: "our_analysis", text: "our Week 2 experiments (rf_comparison, rf_controls)" }]}
      coverage={`960 videos with our features${hasSelection ? ` · ${withBins} of ${selected.length} selected videos have temporal features` : ""}`}
    />
  );
  if (!experiments) {
    return (
      <Panel title="Model experiments" source={source}>
        <div className={ui.empty}>Experiment results not found. Run compare_rf.py and compare_controls.py in pmsv_windows to produce rf_comparison.csv and rf_controls*.csv.</div>
      </Panel>
    );
  }
  const comp = aggregate(experiments.filter((r) => r.table === "comparison")).sort((a, b) => a.mean - b.mean);
  const ctrlAll = aggregate(experiments.filter((r) => r.table === "controls"));
  const kindOrder = ["concat", "shuffled", "summary", "late_fusion"];
  const ctrl = [
    ...ctrlAll.filter((r) => r.k == null),
    ...[3, 5, 10].flatMap((k) => kindOrder.map((kind) => ctrlAll.find((r) => r.k === k && r.kind === kind)).filter((r): r is Agg => !!r)),
  ];
  const all = [...comp, ...ctrl];
  const ext = [d3.min(all, (r) => Math.min(r.lo, r.mean - r.sd))!, d3.max(all, (r) => Math.max(r.hi, r.mean + r.sd))!];
  const half = Math.max(300, (size.width - 30) / 2);
  const x = d3.scaleLinear().domain(ext).nice().range([0, half - 270]);
  const seeds = d3.max(ctrlAll, (r) => r.seeds) ?? 1;
  return (
    <Panel title="Model experiments: CV mean squared error per condition (lower is better)" source={source} scroll>
      <div ref={ref} style={{ display: "flex", gap: 24, padding: "0 10px", flexWrap: "wrap" }}>
        <DotPlot title="Which features and time spans (sorted)" rows={comp} baseline={comp.find((r) => r.condition === "own_whole")} x={x} width={half} paired={false} />
        <DotPlot title="Does window order matter? (all + video length)" rows={ctrl} baseline={ctrl.find((r) => r.condition === "own_whole + len")} x={x} width={half} paired />
      </div>
      <div className={ui.caption}>
        10×10 cross-validated Random Forest MSE on 960 videos. Dot = mean; black bar = range across {seeds} distinct seed runs; gray bar = ±1 SD across CV repeats
        (single run). Bracket pairs windows in order with the same windows shuffled. Dashed line = whole-video baseline (hollow dot). Windows split each
        video into k equal parts; "summary stats" = mean, SD, min, max and slope of each feature across windows. One controls file was an exact duplicate of
        another and is counted once.
      </div>
    </Panel>
  );
}
