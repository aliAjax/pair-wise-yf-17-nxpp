import { useMemo } from "react";
import type { EntityType, LocalState } from "../types";
import { fmtCents } from "../compensation";
import { pipeAnomalyReasons } from "../store";
import { SectionTitle } from "./ui";

type Props = {
  s: LocalState;
  onField: (entityType: EntityType, entityId: string, field: string, value: unknown) => void;
};

export function AnomaliesView({ s, onField }: Props) {
  const rows = useMemo(() => {
    return Object.values(s.pipes)
      .map((pipe) => ({ pipe, reasons: pipeAnomalyReasons(s, pipe) }))
      .filter((r) => r.reasons.length > 0)
      .sort((a, b) => {
        const da = Math.abs(a.pipe.reducedCents ?? 0);
        const db = Math.abs(b.pipe.reducedCents ?? 0);
        return db - da;
      });
  }, [s]);

  return (
    <section className="panel">
      <SectionTitle
        eyebrow="异常标记"
        title="异常音管与复检清单"
        extra={<span className="hint">{rows.length} 根待处理</span>}
      />
      {rows.length === 0 ? (
        <p className="hint">当前没有异常音管。</p>
      ) : (
        <div className="records">
          {rows.map(({ pipe, reasons }) => {
            const stop = s.stops[pipe.stopId];
            return (
              <article key={pipe.id} className="anomaly-row">
                <b className="anomaly-badge">{fmtCents(pipe.reducedCents)}</b>
                <div>
                  <h3>
                    {pipe.label} <span className="sub">{pipe.id}</span>
                  </h3>
                  <p>
                    {stop?.name} · 折算偏差 <b>{fmtCents(pipe.reducedCents)}</b> 音分
                    {pipe.reducedStale && <span className="sub stale"> · 已按新基准重算</span>}
                  </p>
                  <p className="reasons">
                    {reasons.map((r) => (
                      <span key={r} className="badge badge-failed">
                        {r}
                      </span>
                    ))}
                  </p>
                  <p className="hint">备注：{pipe.notes.value || "—"}</p>
                </div>
                <button
                  className={pipe.marked.value ? "primary" : ""}
                  onClick={() => onField("pipe", pipe.id, "marked", !pipe.marked.value)}
                >
                  {pipe.marked.value ? "已标记复检" : "标记复检"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
