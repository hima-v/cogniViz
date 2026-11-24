import type { CompareResult, Detail, ExperimentRow, Insight, Meta, Video } from "./types";

export const API = (import.meta.env.VITE_API as string | undefined) ?? "http://127.0.0.1:8000";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export const fetchMeta = () => get<Meta>("/api/meta");
export const fetchVideos = () => get<Video[]>("/api/videos");
export const fetchInsights = () => get<Insight[]>("/api/insights");
export const fetchExperiments = () => get<ExperimentRow[]>("/api/experiments");

const detailCache = new Map<string, Promise<Detail>>();
export function fetchDetail(id: string): Promise<Detail> {
  let p = detailCache.get(id);
  if (!p) {
    p = get<Detail>(`/api/videos/${id}`);
    detailCache.set(id, p);
    p.catch(() => detailCache.delete(id));
  }
  return p;
}

export async function postCompare(ids: string[], opts: { pool?: string[]; ids2?: string[] }, signal?: AbortSignal): Promise<CompareResult> {
  const r = await fetch(API + "/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, baseline: opts.ids2 ? null : "rest", ids2: opts.ids2 ?? null, pool: opts.pool ?? null }),
    signal,
  });
  if (!r.ok) throw new Error(`compare: ${r.status}`);
  return (await r.json()) as CompareResult;
}

export const mediaUrl = (id: string) => `${API}/media/${id}`;
export const thumbUrl = (id: string, pos: 25 | 50 | 75) => `${API}/thumbs/${id}/${pos}`;
