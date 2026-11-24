import type { ReactNode } from "react";
import { useAppState, useDispatch } from "../state";
import type { BottomTab } from "../types";
import css from "./BottomTabs.module.css";

const TABS: { key: BottomTab; label: string }[] = [
  { key: "different", label: "What's different here?" },
  { key: "attributes", label: "Attributes" },
  { key: "experiments", label: "Experiments" },
];

export function BottomTabs({ views }: { views: Record<BottomTab, ReactNode> }) {
  const { bottomTab, bottomTabPinned } = useAppState();
  const dispatch = useDispatch();
  return (
    <div className={css.wrap}>
      <div className={css.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={bottomTab === t.key}
            className={`${css.tab} ${bottomTab === t.key ? css.active : ""}`}
            // Choosing another tab pins it so new selections don't switch away; choosing the comparison tab unpins.
            onClick={() => dispatch({ type: "tab", tab: t.key, pin: t.key !== "different" })}
          >
            {t.label}
          </button>
        ))}
        {bottomTabPinned && bottomTab !== "different" && (
          <button className={css.pin} title="New selections will switch to the comparison tab again" onClick={() => dispatch({ type: "tab", tab: bottomTab, pin: false })}>
            pinned · unpin
          </button>
        )}
      </div>
      <div className={css.body}>{views[bottomTab]}</div>
    </div>
  );
}
