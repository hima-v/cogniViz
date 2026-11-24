import * as d3 from "d3";

function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
  const r = new Array<number>(a.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(x: number[], y: number[]): number {
  const mx = d3.mean(x)!;
  const my = d3.mean(y)!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export function spearman(x: number[], y: number[]): number {
  return x.length < 3 ? NaN : pearson(ranks(x), ranks(y));
}

/** Mean of y within quantile bins of x. */
export function binnedMeans(x: number[], y: number[], nBins = 10): { x: number; y: number; n: number }[] {
  if (x.length < nBins * 3) nBins = Math.max(2, Math.floor(x.length / 3));
  const order = d3.range(x.length).sort((a, b) => x[a] - x[b]);
  const out: { x: number; y: number; n: number }[] = [];
  for (let b = 0; b < nBins; b++) {
    const slice = order.slice(Math.floor((b * order.length) / nBins), Math.floor(((b + 1) * order.length) / nBins));
    if (!slice.length) continue;
    out.push({ x: d3.median(slice, (i) => x[i])!, y: d3.mean(slice, (i) => y[i])!, n: slice.length });
  }
  return out;
}

/** Deterministic jitter in [-0.5, 0.5) from an id string. */
export function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}
