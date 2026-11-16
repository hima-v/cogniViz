import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { ApplyState, BottomTab, ColorBy, ExperimentRow, Filters, Insight, Meta, Method, RatingTarget, SampleSort, Video } from "./types";

export interface GroupHover {
  kind: "cluster" | "issue";
  value: string | number;
}

export interface State {
  selectedIds: ReadonlySet<string>;
  pinnedGroupA: string[] | null;
  bottomTab: BottomTab;
  bottomTabPinned: boolean;
  showLabels: boolean;
  showContours: boolean;
  sampleSort: SampleSort;
  hoveredId: string | null;
  hoverGroup: GroupHover | null;
  focusedId: string | null;
  colorBy: ColorBy;
  projection: Method;
  k: number;
  ratingTarget: RatingTarget;
  xAttribute: string;
  v3Mode: "issue" | "scatter";
  filters: Filters;
  showCI: boolean;
  activeInsight: string | null;
  provenanceOpen: string | null; // source id to scroll to, "all", or null
  // Analysis trail (v0.2 will add revert + Markdown export on top of this)
  history: { action: string; at: number }[];
}

export const DEFAULT_FILTERS: Filters = {
  issues: [],
  tagMode: "sampled",
  accountTypes: [],
  aspects: [],
  speech: "all",
  hideImputed: false,
  hideNoFace: false,
};

export const INITIAL: State = {
  selectedIds: new Set(),
  pinnedGroupA: null,
  bottomTab: "different",
  bottomTabPinned: false,
  showLabels: true,
  showContours: true,
  sampleSort: "rating",
  hoveredId: null,
  hoverGroup: null,
  focusedId: null,
  colorBy: "rating",
  projection: "tsne",
  k: 6,
  ratingTarget: "overall",
  xAttribute: "log_duration",
  v3Mode: "issue",
  filters: DEFAULT_FILTERS,
  showCI: false,
  activeInsight: null,
  provenanceOpen: null,
  history: [],
};

type Settable = Omit<State, "selectedIds" | "filters" | "history" | "hoveredId" | "hoverGroup" | "provenanceOpen" | "activeInsight">;

export type Action =
  | { type: "select"; ids: string[]; add?: boolean }
  | { type: "clearSelection" }
  | { type: "hover"; id: string | null }
  | { type: "hoverGroup"; group: GroupHover | null }
  | { type: "focus"; id: string | null }
  | { type: "set"; patch: Partial<Settable> }
  | { type: "filters"; patch: Partial<Filters> }
  | { type: "applyInsight"; insight: Insight }
  | { type: "tab"; tab: BottomTab; pin?: boolean }
  | { type: "pinA" }
  | { type: "unpinA" }
  | { type: "provenance"; open: string | null }
  | { type: "escape" }
  | { type: "reset" };

const UI_ONLY = new Set(["hover", "hoverGroup", "provenance"]);

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "select": {
      const next = new Set(a.add ? s.selectedIds : []);
      a.ids.forEach((id) => next.add(id));
      return {
        ...s,
        selectedIds: next,
        activeInsight: null,
        bottomTab: s.bottomTabPinned || next.size === 0 ? s.bottomTab : "different",
      };
    }
    case "clearSelection":
      return { ...s, selectedIds: new Set(), activeInsight: null };
    case "hover":
      return s.hoveredId === a.id ? s : { ...s, hoveredId: a.id };
    case "hoverGroup":
      return { ...s, hoverGroup: a.group };
    case "focus":
      return { ...s, focusedId: a.id };
    case "set":
      return { ...s, ...a.patch, activeInsight: null };
    case "filters":
      return { ...s, filters: { ...s.filters, ...a.patch }, activeInsight: null };
    case "applyInsight": {
      const ap: Partial<ApplyState> = a.insight.apply;
      const { filters, ...rest } = ap;
      return {
        ...INITIAL,
        history: s.history,
        focusedId: s.focusedId,
        ...rest,
        filters: { ...DEFAULT_FILTERS, ...(filters ?? {}) },
        bottomTabPinned: ap.bottomTab != null && ap.bottomTab !== "different",
        activeInsight: a.insight.id,
      };
    }
    case "tab":
      return { ...s, bottomTab: a.tab, bottomTabPinned: a.pin ?? s.bottomTabPinned };
    case "pinA":
      return s.selectedIds.size ? { ...s, pinnedGroupA: [...s.selectedIds], selectedIds: new Set(), bottomTab: "different" } : s;
    case "unpinA":
      return { ...s, pinnedGroupA: null };
    case "provenance":
      return { ...s, provenanceOpen: a.open };
    case "escape":
      if (s.provenanceOpen) return { ...s, provenanceOpen: null };
      return { ...s, selectedIds: new Set(), focusedId: null, hoveredId: null };
    case "reset":
      return { ...INITIAL, history: s.history };
  }
}

function reducer(s: State, a: Action): State {
  const next = reduce(s, a);
  if (UI_ONLY.has(a.type) || next === s) return next;
  return { ...next, history: [...s.history.slice(-199), { action: a.type, at: Date.now() }] };
}

const StateCtx = createContext<State>(INITIAL);
const DispatchCtx = createContext<Dispatch<Action>>(() => {});

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  return (
    <DispatchCtx.Provider value={dispatch}>
      <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
    </DispatchCtx.Provider>
  );
}

export const useAppState = () => useContext(StateCtx);
export const useDispatch = () => useContext(DispatchCtx);

// ---------- loaded data + derived filtered set
export interface Data {
  meta: Meta;
  videos: Video[];
  byId: Map<string, Video>;
  insights: Insight[];
  experiments: ExperimentRow[] | null;
}
export interface Derived extends Data {
  filtered: Video[];
  filteredIds: ReadonlySet<string>;
  /** selected videos that survive the filters */
  selected: Video[];
  hasSelection: boolean;
}

const DataCtx = createContext<Derived | null>(null);

export function passes(v: Video, f: Filters): boolean {
  if (f.issues.length) {
    if (f.tagMode === "sampled" ? !f.issues.includes(v.issue) : !v.tags.some((t) => f.issues.includes(t))) return false;
  }
  if (f.accountTypes.length && !f.accountTypes.includes(v.account_type)) return false;
  if (f.aspects.length && !f.aspects.includes(v.aspect)) return false;
  if (f.speech === "yes" && !v.has_speech) return false;
  if (f.speech === "no" && v.has_speech) return false;
  if (f.hideImputed && v.imputed) return false;
  if (f.hideNoFace && v.no_face) return false;
  return true;
}

export function DataProvider({ data, children }: { data: Data; children: ReactNode }) {
  const { filters, selectedIds } = useAppState();
  const value = useMemo<Derived>(() => {
    const filtered = data.videos.filter((v) => passes(v, filters));
    const filteredIds = new Set(filtered.map((v) => v.id));
    const selected = filtered.filter((v) => selectedIds.has(v.id));
    return { ...data, filtered, filteredIds, selected, hasSelection: selected.length > 0 };
  }, [data, filters, selectedIds]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): Derived {
  const d = useContext(DataCtx);
  if (!d) throw new Error("useData outside DataProvider");
  return d;
}
