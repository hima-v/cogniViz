import * as d3 from "d3";
import { useId } from "react";
import {
  ACCOUNT_COLORS,
  IMPUTED_COLORS,
  IMPUTED_LABELS,
  ISSUE_ORDER,
  RATER_SD_DOMAIN,
  RATING_DOMAIN,
  RATING_TARGETS,
  RESIDUAL_MAX,
  SPEECH_COLORS,
  accountLabel,
  clusterColor,
  issueColor,
  raterSdColor,
  ratingColor,
  residualColor,
} from "../encodings";
import { useAppState, useData, useDispatch } from "../state";
import type { ColorBy } from "../types";
import { ui } from "./ui";

function Gradient({ color, domain, left, right, title }: { color: (x: number) => string; domain: [number, number]; left: string; right: string; title: string }) {
  const id = useId().replace(/:/g, "");
  const stops = d3.range(0, 1.0001, 0.1).map((t) => ({ t, c: color(domain[0] + t * (domain[1] - domain[0])) }));
  const ticks = d3.ticks(domain[0], domain[1], 5);
  const W = 150;
  const x = d3.scaleLinear().domain(domain).range([0, W]);
  return (
    <span className={ui.legendItem}>
      <span>{title}</span>
      <svg width={W + 12} height={34} aria-label={`${title} color scale`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={id}>
            {stops.map((s) => (
              <stop key={s.t} offset={`${s.t * 100}%`} stopColor={s.c} />
            ))}
          </linearGradient>
        </defs>
        <g transform="translate(6,0)">
          <rect width={W} height={9} fill={`url(#${id})`} rx={2} />
          {ticks.map((t) => (
            <g key={t} transform={`translate(${x(t)},9)`}>
              <line y2={3} stroke="#777" />
              <text y={13} fontSize={9} textAnchor="middle" fill="#555">
                {t}
              </text>
            </g>
          ))}
          <text x={0} y={32} fontSize={9} fill="#777">
            {left}
          </text>
          <text x={W} y={32} fontSize={9} fill="#777" textAnchor="end">
            {right}
          </text>
        </g>
      </svg>
    </span>
  );
}

function Swatches({ items, onHover }: { items: { key: string; label: string; color: string }[]; onHover?: (key: string | null) => void }) {
  return (
    <>
      {items.map((it) => (
        <span
          key={it.key}
          className={ui.legendItem}
          onMouseEnter={() => onHover?.(it.key)}
          onMouseLeave={() => onHover?.(null)}
          style={onHover ? { cursor: "pointer" } : undefined}
        >
          <span className={ui.swatch} style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </>
  );
}

export function ShapeLegend() {
  const tri = d3.symbol(d3.symbolTriangle, 40)() ?? "";
  const cir = d3.symbol(d3.symbolCircle, 40)() ?? "";
  return (
    <span className={ui.legendItem} style={{ gap: 8 }}>
      <span className={ui.legendItem}>
        <svg width={10} height={10}>
          <path d={cir} transform="translate(5,5)" fill="#888" />
        </svg>
        Popular account
      </span>
      <span className={ui.legendItem}>
        <svg width={10} height={10}>
          <path d={tri} transform="translate(5,6)" fill="#888" />
        </svg>
        Ordinary account
      </span>
    </span>
  );
}

export function ColorLegend({ colorBy, showShapes = true }: { colorBy: ColorBy; showShapes?: boolean }) {
  const { ratingTarget, k } = useAppState();
  const { meta } = useData();
  const dispatch = useDispatch();
  let body;
  switch (colorBy) {
    case "rating":
      body = <Gradient color={ratingColor} domain={RATING_DOMAIN} left="low" right="high" title={RATING_TARGETS[ratingTarget].label + " (1–7)"} />;
      break;
    case "residual":
      body = (
        <Gradient
          color={residualColor}
          domain={[-RESIDUAL_MAX, RESIDUAL_MAX]}
          left="model too low"
          right="model too high"
          title="Model error, predicted − actual"
        />
      );
      break;
    case "raterSd":
      body = <Gradient color={raterSdColor} domain={RATER_SD_DOMAIN} left="raters agree" right="raters disagree" title="Rater SD (points)" />;
      break;
    case "issue":
      body = (
        <Swatches
          items={ISSUE_ORDER.map((i) => ({ key: i, label: meta.issues[i], color: issueColor(i) }))}
          onHover={(key) => dispatch({ type: "hoverGroup", group: key ? { kind: "issue", value: key } : null })}
        />
      );
      break;
    case "account":
      body = <Swatches items={Object.entries(ACCOUNT_COLORS).map(([key, color]) => ({ key, label: accountLabel(key), color }))} />;
      break;
    case "cluster":
      body = (
        <Swatches
          items={meta.clusters[String(k)].clusters.map((c) => ({ key: String(c.cluster), label: c.label, color: clusterColor(c.cluster) }))}
          onHover={(key) => dispatch({ type: "hoverGroup", group: key == null ? null : { kind: "cluster", value: Number(key) } })}
        />
      );
      break;
    case "imputed":
      body = <Swatches items={Object.entries(IMPUTED_COLORS).map(([key, color]) => ({ key, label: IMPUTED_LABELS[key], color }))} />;
      break;
    case "speech":
      body = (
        <Swatches
          items={[
            { key: "yes", label: "Speech detected", color: SPEECH_COLORS.yes },
            { key: "no", label: "No speech detected", color: SPEECH_COLORS.no },
          ]}
        />
      );
      break;
  }
  return (
    <div className={ui.legend}>
      {body}
      {showShapes && colorBy !== "account" && <ShapeLegend />}
      <span className={ui.legendItem}>
        <span className={ui.swatch} style={{ background: "#c8c8c8" }} /> not selected
      </span>
    </div>
  );
}
