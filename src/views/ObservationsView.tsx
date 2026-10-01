import { useMemo, useState } from "react";
import type { LocalState } from "../types";
import { COMPENSATION, fmtCents, fmtDateTime } from "../compensation";
import { SectionTitle } from "./ui";

type Props = {
  s: LocalState;
  onAdd: (obs: { venue: string; temp: number; humidity: number; note: string }) => void;
};

export function ObservationsView({ s, onAdd }: Props) {
  const venues = useMemo(
    () => Array.from(new Set(Object.values(s.stops).map((x) => x.venue))),
    [s.stops]
  );
  const [venue, setVenue] = useState(venues[0] ?? "圣玛丽教堂");
  const [temp, setTemp] = useState(22);
  const [humidity, setHumidity] = useState(45);
  const [note, setNote] = useState("");

  const list = useMemo(
    () =>
      Object.values(s.observations).sort(
        (a, b) => b.recordedAt.value - a.recordedAt.value
      ),
    [s.observations]
  );

  const submit = () => {
    onAdd({ venue, temp: Number(temp), humidity: Number(humidity), note: note.trim() });
    setNote("");
  };

  return (
    <section className="panel">
      <SectionTitle
        eyebrow="温湿度观测"
        title="观测记录与补偿量"
        extra={
          <span className="hint">
            补偿口径与音栓台账一致：基准 {s.baseTemp}°C / {COMPENSATION.baseHumidity}%RH
          </span>
        }
      />

      <div className="obs-form">
        <label>
          <span>场馆</span>
          <select value={venue} onChange={(e) => setVenue(e.target.value)}>
            {venues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>温度（°C）</span>
          <input
            type="number"
            step="0.1"
            value={temp}
            onChange={(e) => setTemp(Number(e.target.value))}
          />
        </label>
        <label>
          <span>湿度（%RH）</span>
          <input
            type="number"
            value={humidity}
            onChange={(e) => setHumidity(Number(e.target.value))}
          />
        </label>
        <label className="obs-note">
          <span>备注</span>
          <input
            type="text"
            value={note}
            placeholder="观测条件说明"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button className="primary" onClick={submit}>
          登记观测
        </button>
      </div>

      <div className="records">
        {list.map((o) => {
          const effect = COMPENSATION.totalEffectCents(
            o.temp.value,
            o.humidity.value,
            s.baseTemp
          );
          return (
            <article key={o.id}>
              <b>{fmtCents(effect)}</b>
              <div>
                <h3>
                  {o.venue.value} · {o.temp.value}°C / {o.humidity.value}%RH
                </h3>
                <p>
                  {fmtDateTime(o.recordedAt.value)} · {o.recordedBy.value}
                  {o.note.value ? ` · ${o.note.value}` : ""}
                </p>
                <p className="hint">
                  补偿量 {fmtCents(effect)} 音分（温度{" "}
                  {fmtCents(COMPENSATION.tempEffectCents(o.temp.value, s.baseTemp))} + 湿度{" "}
                  {fmtCents(
                    COMPENSATION.humidityEffectCents(o.humidity.value, COMPENSATION.baseHumidity)
                  )}
                  ）；音管折算偏差 = 实测 − 该补偿量。
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
