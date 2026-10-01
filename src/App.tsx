import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  COMPENSATION_BASIS_TEXT,
  DEVIATION_LIMIT_CENTS,
  compensateCents,
  expectedOffset,
} from "./domain/compensation";
import { VENUES } from "./domain/seed";
import {
  FIELD_LABELS,
  type ConflictItem,
  type PipeField,
  type PipeRecord,
  type ReedStatus,
  type StopDef,
  type SyncStatus,
} from "./domain/types";
import { useWorkbench } from "./hooks/useWorkbench";

const REED_OPTIONS: ReedStatus[] = ["正常", "簧片需微调", "标记复检", "需更换"];

const SYNC_LABEL: Record<SyncStatus, string> = {
  pending: "待回传",
  syncing: "回传中…",
  synced: "已同步",
  failed: "失败待补",
  conflict: "冲突待确认",
};

const REPORT_STATUS_LABEL = {
  draft: "草稿",
  confirmed: "已确认",
  pending_review: "待复核",
} as const;

const fmtCents = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function fmtFieldValue(field: PipeField, value: unknown, stops: StopDef[]): string {
  switch (field) {
    case "measuredCents":
      return fmtCents(Number(value)) + " cent";
    case "obsTemp":
      return `${value} °C`;
    case "obsHumidity":
      return `${value} %`;
    case "anomaly":
      return value ? "异常" : "正常";
    case "stopId":
      return stops.find((s) => s.id === value)?.name ?? String(value);
    default:
      return String(value);
  }
}

/** 音栓台账与温湿度观测共用同一段补偿口径说明 */
function CompensationBasis() {
  return <p className="basis">📐 {COMPENSATION_BASIS_TEXT}</p>;
}

interface FormState {
  pipeId: string;
  venue: string;
  stopId: string;
  pitch: string;
  measuredCents: string;
  obsTemp: string;
  obsHumidity: string;
  reedStatus: ReedStatus;
  note: string;
  anomaly: boolean;
}

const EMPTY_FORM: FormState = {
  pipeId: "",
  venue: VENUES[0],
  stopId: "st-trumpet8",
  pitch: "",
  measuredCents: "0",
  obsTemp: "20",
  obsHumidity: "55",
  reedStatus: "正常",
  note: "",
  anomaly: false,
};

function App() {
  const wb = useWorkbench();
  const { state } = wb;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("全部");
  const [baseTempInput, setBaseTempInput] = useState(String(state.baseTemp));
  const [envForm, setEnvForm] = useState({ venue: VENUES[0], temp: "20", humidity: "55" });
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    setBaseTempInput(String(state.baseTemp));
  }, [state.baseTemp]);

  useEffect(() => {
    if (state.lastRecalcAt) setBannerDismissed(false);
  }, [state.lastRecalcAt]);

  const venues = useMemo(
    () => Array.from(new Set([...VENUES, ...state.pipes.map((p) => p.venue)])),
    [state.pipes]
  );

  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(state.stops.map((s) => s.category)))],
    [state.stops]
  );

  const filteredPipes = useMemo(
    () =>
      state.pipes.filter(
        (p) =>
          filter === "全部" ||
          state.stops.find((s) => s.id === p.stopId)?.category === filter
      ),
    [state.pipes, state.stops, filter]
  );

  const latestEnv = state.envObs[0];
  const overLimitCount = state.pipes.filter(
    (p) =>
      Math.abs(compensateCents(p.measuredCents, p.obsTemp, state.baseTemp)) >
      DEVIATION_LIMIT_CENTS
  ).length;
  const pendingCount = state.pipes.filter(
    (p) => p.syncStatus === "pending" || p.syncStatus === "failed"
  ).length;
  const failedCount = state.pipes.filter((p) => p.syncStatus === "failed").length;
  const syncedCount = state.pipes.filter((p) => p.syncStatus === "synced").length;

  const submitForm = () => {
    if (!form.pipeId.trim() || !form.pitch.trim()) {
      window.alert("请填写音管编号和音高");
      return;
    }
    wb.upsertPipe({
      pipeId: form.pipeId.trim(),
      venue: form.venue,
      stopId: form.stopId,
      pitch: form.pitch.trim(),
      measuredCents: Number(form.measuredCents) || 0,
      obsTemp: Number(form.obsTemp) || 0,
      obsHumidity: Number(form.obsHumidity) || 0,
      reedStatus: form.reedStatus,
      note: form.note.trim(),
      anomaly: form.anomaly,
    });
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (p: PipeRecord) => {
    setEditingId(p.pipeId);
    setForm({
      pipeId: p.pipeId,
      venue: p.venue,
      stopId: p.stopId,
      pitch: p.pitch,
      measuredCents: String(p.measuredCents),
      obsTemp: String(p.obsTemp),
      obsHumidity: String(p.obsHumidity),
      reedStatus: p.reedStatus,
      note: p.note,
      anomaly: p.anomaly,
    });
  };

  const submitEnv = () => {
    wb.addEnvObs(envForm.venue, Number(envForm.temp) || 0, Number(envForm.humidity) || 0);
  };

  const applyBaseTemp = () => {
    const t = Number(baseTempInput);
    if (Number.isFinite(t)) wb.changeBaseTemp(t);
  };

  return (
    <main className="app">
      <section className="hero">
        <div className="topbar">
          <span className={`net-badge ${state.online ? "" : "off"}`}>
            ● {state.online ? "在线" : "断网"}
          </span>
          <button onClick={() => wb.setOnline(!state.online)}>
            {state.online ? "模拟断网" : "恢复网络"}
          </button>
          <label className="weak-toggle">
            <input
              type="checkbox"
              checked={state.weakNet}
              onChange={(e) => wb.setWeakNet(e.target.checked)}
            />
            弱网模拟（回传可能失败）
          </label>
          <span className="basetemp">
            基准温度
            <input
              type="number"
              step="0.5"
              value={baseTempInput}
              onChange={(e) => setBaseTempInput(e.target.value)}
            />
            °C
          </span>
          <button onClick={applyBaseTemp}>变更基准温度</button>
          <button
            className="primary"
            disabled={!state.online || state.syncing || pendingCount === 0}
            onClick={() => void wb.syncRun()}
          >
            {state.syncing ? "回传中…" : `回传总档（${pendingCount}）`}
          </button>
        </div>
        <h1>管风琴音管调音续作台</h1>
        <span>
          音栓台账、音分偏差、温湿度观测与异常标记一体化登记。断网照常记录；网络恢复后按音管编号逐字段合并回总档，
          两边改过同一字段就留两版等确认；基准温度一变，音分偏差立即作废重算，已确认报告退回待复核。
        </span>
      </section>

      {state.lastRecalcAt && !bannerDismissed && (
        <div className="banner">
          ⚠ 基准温度已调整为 {state.baseTemp}°C：全部音分偏差已按统一补偿口径作废重算；
          已确认的维护报告已退回「待复核」。
          <button onClick={() => setBannerDismissed(true)}>知道了</button>
        </div>
      )}

      <section className="metrics">
        <article>
          <small>音栓数量</small>
          <strong>{state.stops.length}</strong>
        </article>
        <article>
          <small>偏差超限（&gt;{DEVIATION_LIMIT_CENTS} cent）</small>
          <strong>{overLimitCount}</strong>
        </article>
        <article>
          <small>温度（最新观测）</small>
          <strong>{latestEnv ? `${latestEnv.temp}°C` : "—"}</strong>
        </article>
        <article>
          <small>湿度（最新观测）</small>
          <strong>{latestEnv ? `${latestEnv.humidity}%` : "—"}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <div className="heading">
            <div>
              <p>台账</p>
              <h2>音栓台账</h2>
            </div>
          </div>
          <table className="sheet">
            <thead>
              <tr>
                <th>音栓</th>
                <th>类别</th>
                <th>管数</th>
                <th>在录</th>
                <th>平均补偿偏差</th>
              </tr>
            </thead>
            <tbody>
              {state.stops.map((s) => {
                const ps = state.pipes.filter((p) => p.stopId === s.id);
                const avg = ps.length
                  ? ps.reduce(
                      (a, p) =>
                        a +
                        Math.abs(compensateCents(p.measuredCents, p.obsTemp, state.baseTemp)),
                      0
                    ) / ps.length
                  : null;
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.category}</td>
                    <td>{s.pipes}</td>
                    <td>{ps.length}</td>
                    <td
                      className={
                        avg !== null && avg > DEVIATION_LIMIT_CENTS ? "dev-over" : "dev-ok"
                      }
                    >
                      {avg === null ? "—" : `${avg.toFixed(1)} cent`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <CompensationBasis />
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>{state.online ? "在线登记" : "离线登记（断网照常）"}</p>
              <h2>{editingId ? `编辑 ${editingId}` : "调音登记"}</h2>
            </div>
            <div className="row-actions">
              {editingId && (
                <button
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY_FORM);
                  }}
                >
                  取消编辑
                </button>
              )}
              <button className="primary" onClick={submitForm}>
                {editingId ? "保存修改" : "登记（离线可用）"}
              </button>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>场馆名称</span>
              <select
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
              >
                {venues.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              <span>音栓</span>
              <select
                value={form.stopId}
                onChange={(e) => setForm({ ...form, stopId: e.target.value })}
              >
                {state.stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.category}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>音管编号</span>
              <input
                placeholder="如 TRP8-CS4"
                value={form.pipeId}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm({ ...form, pipeId: e.target.value })}
              />
            </label>
            <label>
              <span>音高</span>
              <input
                placeholder="如 C#4"
                value={form.pitch}
                onChange={(e) => setForm({ ...form, pitch: e.target.value })}
              />
            </label>
            <label>
              <span>实测音分（观测温度下）</span>
              <input
                type="number"
                step="0.5"
                value={form.measuredCents}
                onChange={(e) => setForm({ ...form, measuredCents: e.target.value })}
              />
            </label>
            <label>
              <span>观测温度 °C</span>
              <input
                type="number"
                step="0.5"
                value={form.obsTemp}
                onChange={(e) => setForm({ ...form, obsTemp: e.target.value })}
              />
            </label>
            <label>
              <span>观测湿度 %</span>
              <input
                type="number"
                step="1"
                value={form.obsHumidity}
                onChange={(e) => setForm({ ...form, obsHumidity: e.target.value })}
              />
            </label>
            <label>
              <span>簧片状态</span>
              <select
                value={form.reedStatus}
                onChange={(e) =>
                  setForm({ ...form, reedStatus: e.target.value as ReedStatus })
                }
              >
                {REED_OPTIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="span-2">
              <span>维修备注</span>
              <input
                placeholder="填写维修备注"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.anomaly}
                onChange={(e) => setForm({ ...form, anomaly: e.target.checked })}
              />
              <span>标记为异常音管</span>
            </label>
          </div>
          <p className="hint">
            断网照常登记：记录先存本地队列，恢复网络后自动补传未同步音管；重复回传不会生成第二份记录。
          </p>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>音分偏差（补偿口径 T₀ = {state.baseTemp}°C）</p>
            <h2>调音偏差表</h2>
          </div>
          <div className="chips">
            {categories.map((c) => (
              <button
                key={c}
                className={filter === c ? "chip-active" : ""}
                onClick={() => setFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <table className="sheet">
          <thead>
            <tr>
              <th>音管编号</th>
              <th>场馆 / 音栓</th>
              <th>音高</th>
              <th>实测音分</th>
              <th>观测温度</th>
              <th>补偿后偏差</th>
              <th>异常</th>
              <th>总档同步</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredPipes.map((p) => {
              const dev = compensateCents(p.measuredCents, p.obsTemp, state.baseTemp);
              const over = Math.abs(dev) > DEVIATION_LIMIT_CENTS;
              const stopName = state.stops.find((s) => s.id === p.stopId)?.name ?? p.stopId;
              return (
                <tr key={p.pipeId} className={p.syncStatus === "conflict" ? "row-conflict" : ""}>
                  <td>
                    <b>{p.pipeId}</b>
                  </td>
                  <td>
                    {p.venue} / {stopName}
                  </td>
                  <td>{p.pitch}</td>
                  <td>{fmtCents(p.measuredCents)}</td>
                  <td>{p.obsTemp}°C</td>
                  <td className={over ? "dev-over" : "dev-ok"}>
                    {fmtCents(dev)} cent{over ? " ⚠" : ""}
                  </td>
                  <td>
                    <button
                      className="flag"
                      title="切换异常标记"
                      onClick={() => wb.toggleAnomaly(p.pipeId)}
                    >
                      {p.anomaly ? "🚩" : "○"}
                    </button>
                  </td>
                  <td>
                    <span className={`badge sync-${p.syncStatus}`}>
                      {SYNC_LABEL[p.syncStatus]}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => startEdit(p)}>编辑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="grid-2">
        <section className="panel">
          <div className="heading">
            <div>
              <p>环境</p>
              <h2>温湿度观测</h2>
            </div>
          </div>
          <div className="env-form">
            <select
              value={envForm.venue}
              onChange={(e) => setEnvForm({ ...envForm, venue: e.target.value })}
            >
              {venues.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <input
              type="number"
              step="0.5"
              value={envForm.temp}
              onChange={(e) => setEnvForm({ ...envForm, temp: e.target.value })}
              placeholder="温度 °C"
            />
            <input
              type="number"
              step="1"
              value={envForm.humidity}
              onChange={(e) => setEnvForm({ ...envForm, humidity: e.target.value })}
              placeholder="湿度 %"
            />
            <button className="primary" onClick={submitEnv}>
              登记观测
            </button>
          </div>
          <ul className="env-list">
            {state.envObs.slice(0, 6).map((o) => (
              <li key={o.id}>
                <span>{fmtTime(o.at)}</span>
                <b>{o.venue}</b>
                <span>
                  {o.temp}°C / {o.humidity}%
                </span>
                <span className="offset">
                  期望偏移 {fmtCents(expectedOffset(o.temp, state.baseTemp))} cent
                </span>
              </li>
            ))}
          </ul>
          <CompensationBasis />
        </section>

        <section className="panel">
          <div className="heading">
            <div>
              <p>离线登记 → 弱网回传 → 逐字段合并</p>
              <h2>总档同步与冲突确认</h2>
            </div>
            <div className="row-actions">
              <button onClick={wb.simulatePeer}>模拟另一调音师回传</button>
              <button
                className="primary"
                disabled={!state.online || state.syncing || pendingCount === 0}
                onClick={() => void wb.syncRun()}
              >
                {state.syncing ? "回传中…" : `回传总档（${pendingCount}）`}
              </button>
            </div>
          </div>
          <p className="sync-summary">
            待回传 {pendingCount - failedCount} · 失败待补 {failedCount} · 冲突待确认{" "}
            {state.conflicts.length} · 已同步 {syncedCount}
          </p>
          {state.conflicts.length > 0 && (
            <div className="conflicts">
              {state.conflicts.map((c: ConflictItem) => (
                <div className="conflict-item" key={`${c.pipeId}-${c.field}`}>
                  <b>
                    {c.pipeId} · {FIELD_LABELS[c.field]}
                  </b>
                  <div className="vs">
                    <div>
                      <small>本地版本</small>
                      <p>{fmtFieldValue(c.field, c.localValue, state.stops)}</p>
                      <button onClick={() => wb.resolveConflict(c.pipeId, c.field, "local")}>
                        采用本地
                      </button>
                    </div>
                    <div>
                      <small>总档版本</small>
                      <p>{fmtFieldValue(c.field, c.masterValue, state.stops)}</p>
                      <button onClick={() => wb.resolveConflict(c.pipeId, c.field, "master")}>
                        采用总档
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="log">
            {state.syncLog.slice(-10).map((l, i) => (
              <span key={`${i}-${l}`}>{l}</span>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>年度归档</p>
            <h2>维护报告</h2>
          </div>
          <div className="chips">
            {venues.map((v) => (
              <button key={v} onClick={() => wb.generateReport(v)}>
                生成/刷新 {v} 年报
              </button>
            ))}
          </div>
        </div>
        <div className="reports">
          {state.reports.map((r) => (
            <article className="report-card" key={r.id}>
              <header>
                <b>
                  {r.venue} · {r.year} 年度维护报告
                </b>
                <span className={`badge report-${r.status}`}>
                  {REPORT_STATUS_LABEL[r.status]}
                </span>
              </header>
              <div className="stat-grid">
                <div>
                  <small>在录音管</small>
                  <strong>{r.totalPipes}</strong>
                </div>
                <div>
                  <small>异常标记</small>
                  <strong>{r.anomalies}</strong>
                </div>
                <div>
                  <small>偏差超限</small>
                  <strong>{r.overLimit}</strong>
                </div>
                <div>
                  <small>平均 |偏差|</small>
                  <strong>{r.avgAbsDeviation} cent</strong>
                </div>
              </div>
              <p className="meta">
                基准温度 {r.baseTemp}°C · 生成于 {fmtTime(r.generatedAt)}
                {r.confirmedAt ? ` · 确认于 ${fmtTime(r.confirmedAt)}` : ""}
              </p>
              {r.note && <p className="note">⚠ {r.note}</p>}
              {r.status !== "confirmed" && (
                <button className="primary" onClick={() => wb.confirmReport(r.id)}>
                  {r.status === "pending_review" ? "复核后重新确认" : "确认报告"}
                </button>
              )}
            </article>
          ))}
          {state.reports.length === 0 && <p className="hint">尚未生成报告。</p>}
        </div>
        <p className="basis">
          基准温度一经变更，全部音分偏差立即作废重算，已确认报告自动退回「待复核」，复核无误后重新确认。
        </p>
      </section>
    </main>
  );
}

export default App;
