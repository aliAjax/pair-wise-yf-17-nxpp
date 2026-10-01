import { useMemo } from "react";
import type { LocalState } from "../types";
import { COMPENSATION } from "../compensation";
import { SectionTitle } from "./ui";

export function StopsView({ s }: { s: LocalState }) {
  const stops = useMemo(
    () => Object.values(s.stops).sort((a, b) => a.id.localeCompare(b.id)),
    [s.stops]
  );
  const venues = useMemo(
    () => Array.from(new Set(stops.map((x) => x.venue))),
    [stops]
  );

  return (
    <section className="panel">
      <SectionTitle
        eyebrow="音栓台账"
        title="音栓与补偿口径"
        extra={<span className="hint">场馆：{venues.join("、")}</span>}
      />
      <div className="stop-grid">
        {stops.map((stop) => (
          <article key={stop.id} className="stop-card">
            <div className="stop-head">
              <h3>{stop.name}</h3>
              <span className="badge badge-kind">{stop.kind}</span>
            </div>
            <dl className="stop-meta">
              <div>
                <dt>所属场馆</dt>
                <dd>{stop.venue}</dd>
              </div>
              <div>
                <dt>音管数</dt>
                <dd>{stop.pipeIds.length} 根</dd>
              </div>
              <div>
                <dt>基准温度</dt>
                <dd>{s.baseTemp} °C（全档统一）</dd>
              </div>
              <div>
                <dt>温度补偿系数</dt>
                <dd>{COMPENSATION.tempCoefficient(s.baseTemp).toFixed(2)} 音分/°C</dd>
              </div>
            </dl>
            <p className="hint">
              系数由公式 600 / (ln2 · T) 推导，台账不另设系数——与温湿度观测页共用同一套补偿口径。
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
