import { useMemo, useState } from "react";
import type { LocalState, ReportStatus } from "../types";
import { fmtDateTime } from "../compensation";
import { REPORT_STATUS_LABELS } from "../store";
import { Badge, SectionTitle } from "./ui";

type Props = {
  s: LocalState;
  onAdd: (r: {
    venue: string;
    title: string;
    date: number;
    tuners: string[];
    pipeIds: string[];
    summary: string;
  }) => void;
  onStatus: (reportId: string, status: ReportStatus) => void;
};

const STATUS_CLS: Record<ReportStatus, string> = {
  draft: "badge-draft",
  pending_review: "badge-pending",
  confirmed: "badge-synced",
};

export function ReportsView({ s, onAdd, onStatus }: Props) {
  const venues = useMemo(
    () => Array.from(new Set(Object.values(s.stops).map((x) => x.venue))),
    [s.stops]
  );
  const [venue, setVenue] = useState(venues[0] ?? "圣玛丽教堂");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tuners, setTuners] = useState(s.identity);
  const [summary, setSummary] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const pipes = useMemo(
    () =>
      Object.values(s.pipes).sort((a, b) =>
        a.id.localeCompare(b.id, undefined, { numeric: true })
      ),
    [s.pipes]
  );

  const list = useMemo(
    () =>
      Object.values(s.reports).sort((a, b) => b.date.value - a.date.value),
    [s.reports]
  );

  const togglePipe = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    if (!title.trim()) return;
    onAdd({
      venue,
      title: title.trim(),
      date: new Date(date + "T12:00:00").getTime(),
      tuners: tuners.split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
      pipeIds: Array.from(picked),
      summary: summary.trim(),
    });
    setTitle("");
    setSummary("");
    setPicked(new Set());
  };

  return (
    <section className="panel">
      <SectionTitle
        eyebrow="单次维护报告"
        title="维护报告与复核"
        extra={<span className="hint">基准温度变更会把已确认报告退回待复核</span>}
      />

      <div className="report-form">
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
          <span>报告标题</span>
          <input value={title} placeholder="如：秋季调音维护" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          <span>维护日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>调音师（顿号分隔）</span>
          <input value={tuners} onChange={(e) => setTuners(e.target.value)} />
        </label>
        <label className="report-summary">
          <span>维护摘要</span>
          <textarea
            value={summary}
            rows={2}
            placeholder="本次维护内容、遗留问题……"
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <div className="report-pipes">
          <span className="field-label">覆盖音管（{picked.size}）</span>
          <div className="pipe-pick-grid">
            {pipes.map((p) => (
              <label key={p.id} className={picked.has(p.id) ? "picked" : ""}>
                <input
                  type="checkbox"
                  checked={picked.has(p.id)}
                  onChange={() => togglePipe(p.id)}
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
        <button className="primary" onClick={submit} disabled={!title.trim()}>
          存为草稿（离线可存）
        </button>
      </div>

      <div className="records">
        {list.map((r) => (
          <article key={r.id}>
            <b className="report-status-bar">
              <Badge cls={STATUS_CLS[r.status.value]}>
                {REPORT_STATUS_LABELS[r.status.value]}
              </Badge>
            </b>
            <div>
              <h3>{r.title.value}</h3>
              <p>
                {r.venue.value} · {fmtDateTime(r.date.value)} · {r.tuners.value.join("、")}
              </p>
              <p className="hint">
                覆盖 {r.pipeIds.value.length} 根音管
                {r.baseTempAtConfirm != null &&
                  ` · 确认时基准 ${r.baseTempAtConfirm}°C`}
              </p>
              {r.summary.value && <p className="report-summary-text">{r.summary.value}</p>}
              <div className="row-actions">
                {r.status.value === "draft" && (
                  <button onClick={() => onStatus(r.id, "pending_review")}>提交复核</button>
                )}
                {r.status.value === "pending_review" && (
                  <button className="primary" onClick={() => onStatus(r.id, "confirmed")}>
                    确认报告
                  </button>
                )}
                {r.status.value === "confirmed" && (
                  <button onClick={() => onStatus(r.id, "pending_review")}>
                    退回待复核
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
