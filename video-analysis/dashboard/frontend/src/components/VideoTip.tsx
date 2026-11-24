import { accountLabel, fmt, RATING_TARGETS, ratingOf, ciOf } from "../encodings";
import { useAppState, useData } from "../state";
import type { Video } from "../types";
import { ui } from "./ui";

export function VideoTip({ v }: { v: Video }) {
  const { ratingTarget } = useAppState();
  const { meta } = useData();
  return (
    <div>
      <div>
        <b>{meta.issues[v.issue]}</b> · {accountLabel(v.account_type)}
      </div>
      <div>
        {RATING_TARGETS[ratingTarget].label}: <b>{fmt(ratingOf(v, ratingTarget))}</b> ± {fmt(ciOf(v, ratingTarget))} (95% CI, {v.n_raters} raters)
      </div>
      <div>
        Predicted (out-of-fold): {fmt(v.pred)} · error {fmt(v.residual)}
      </div>
      <div className={ui.muted}>
        {fmt(v.duration, 0)} s · id {v.id}
        {v.imputed && <span className={ui.warn}> · imputed: {[v.no_face && "face time", v.silent && "audio"].filter(Boolean).join(", ")}</span>}
      </div>
    </div>
  );
}
