import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useDispatch } from "../state";
import css from "./ui.module.css";

export function useSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1 ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export interface SourcePart {
  id: string;
  text: string;
}

/** One small gray line naming a view's data sources; click opens the Data sources panel at that source. */
export function SourceLine({ parts, coverage }: { parts: SourcePart[]; coverage?: string }) {
  const dispatch = useDispatch();
  return (
    <button
      className={css.source}
      title="Open Data sources"
      onClick={() => dispatch({ type: "provenance", open: parts[0]?.id ?? "all" })}
    >
      Source: {parts.map((p) => p.text).join(" + ")}
      {coverage ? ` · ${coverage}` : ""}
    </button>
  );
}

export function Panel(props: {
  title: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  source: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <section className={`${css.panel} ${props.className ?? ""}`}>
      <div className={css.panelHead}>
        <h2 className={css.panelTitle}>{props.title}</h2>
        {props.controls}
      </div>
      <div className={props.scroll ? css.scrollBody : css.panelBody}>{props.children}</div>
      {props.source}
    </section>
  );
}

/** Tooltip positioned beside (never on top of) the hovered mark. */
export function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y - 14 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x + 14;
    let top = y - h - 10;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top < 8) top = y + 14;
    setPos({ left, top });
  }, [x, y, children]);
  return (
    <div ref={ref} className={css.tooltip} style={pos} role="tooltip">
      {children}
    </div>
  );
}

export function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button className={`${css.btn} ${on ? css.btnActive : ""}`} aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export { css as ui };
