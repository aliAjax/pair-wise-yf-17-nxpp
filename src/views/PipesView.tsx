import { useMemo, useState } from "react";
import type { EntityType, LocalState, ReedState } from "../types";
import { fmtCents, COMPENSATION } from "../compensation";
import { obsForPipe, REED_LABELS, syncBadge } from "../store";
import { Badge, SectionTitle } from "./ui";

type Props = {
  s: LocalState;
  onField: (entityType: EntityType, entityId: string, field: string, value: unknown) => void;
};

const REED_OPTIONS: ReedState[] = ["normal", "needs_tuning", "needs_reed_work", "out_of_service"];

export function PipesView({ s, onField }: Props) {
  const [stopFilter, setStopFilter] = useState<string>("全部");

  const stopOrder = useMemo(
    () => Object.values(s.stops).sort((a, b) => a.id.localeCompare(b.id)),
    [s.stops]
  );

  const rows = useMemo(() => {
    const list = Object.values(s.pipes);
    list.sort((a, b) => {
      const sa = s.stops[a.stopId]?.id ?? "";
      const sb = s.stops[b.stopId]?.id ?? "";
      if (sa !== sb) return sa.localeCompare(sb);
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    return stopFilter === "全部" ? list : list.filter((p) => s.stops[p.stopId]?.name === stopFilter);
  }, [s.pipes, s.stops, stopFilter]);

  return (
    <section className="panel">
      <SectionTitle
        eyebrow="音管台账 · 字段级合并"
        title="音管偏差续作台"
        extra={
          <div className="chips">
            <button
              className={stopFilter === "全部" ? "chip-active" : ""}
              onClick={() => setStopFilter("全部")}
            >
              全部
            </button>
            {stopOrder.map((stop) => (
              <button
                key={stop.id}
                className={stopFilter === stop.name ? "chip-active" : ""}
                onClick={() => setStopFilter(stop.name)}
              >
                {stop.name}
              </button>
            ))}
          </div>
        }
      />
      <p className="hint">
        所有字段离线可改，联网后按「音管编号 + 字段」合并；两边都改过同一字段会在同步中心保留两版等确认。
        补偿口径：实测音分偏差 − 温湿度补偿（基准 {s.baseTemp}°C）= 折算偏差。
      </p>
      <div className="table-wrap">
        <table className="data-table pipes-table">
          <thead>
            <tr>
              <th>音管编号</th>
              <th>音栓</th>
              <th>音高</th>
              <th>实测音分偏差</th>
              <th>簧片状态</th>
              <th>温湿度补偿</th>
              <th>折算偏差</th>
              <th>异常标记</th>
              <th>维修备注</th>
              <th>同步</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((pipe) => {
              const stop = s.stops[pipe.stopId];
              const obs = obsForPipe(s, pipe);
              const effect = COMPENSATION.totalEffectCents(
                obs.temp,
                obs.humidity,
                s.baseTemp
              );
              const badge = syncBadge(s.pipeSync[pipe.id]);
              const reduced = pipe.reducedCents;
              const reducedCls =
                reduced == null
                  ? ""
                  : Math.abs(reduced) > 10
                    ? "cent-danger"
                    : Math.abs(reduced) > 5
                      ? "cent-warn"
                      : "cent-ok";
              return (
                <tr key={pipe.id}>
                  <td>
                    <b>{pipe.label}</b>
                    <div className="sub">{pipe.id}</div>
                  </td>
                  <td>{stop?.name ?? "—"}</td>
                  <td>{pipe.pitch}</td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      className="cell-input"
                      value={pipe.measuredCents.value ?? ""}
                      placeholder="音分"
                      onChange={(e) =>
                        onField(
                          "pipe",
                          pipe.id,
                          "measuredCents",
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="cell-input"
                      value={pipe.reedState.value}
                      onChange={(e) =>
                        onField("pipe", pipe.id, "reedState", e.target.value as ReedState)
                      }
                    >
                      {REED_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {REED_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span title={`观测 ${obs.temp}°C / ${obs.humidity}%RH → 基准 ${s.baseTemp}°C`}>
                      {fmtCents(effect)}
                    </span>
                    <div className="sub">
                      {obs.temp}°C/{obs.humidity}%
                    </div>
                  </td>
                  <td className={reducedCls}>
                    <b>{fmtCents(reduced)}</b>
                    {pipe.reducedStale && <div className="sub stale">重算中</div>}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={pipe.marked.value}
                      onChange={(e) => onField("pipe", pipe.id, "marked", e.target.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="cell-input notes-input"
                      value={pipe.notes.value}
                      onChange={(e) => onField("pipe", pipe.id, "notes", e.target.value)}
                    />
                  </td>
                  <td>
                    <Badge cls={badge.cls}>{badge.text}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
