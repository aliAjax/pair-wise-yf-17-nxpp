import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  addObservation,
  addReport,
  dismissNotice,
  editField,
  loadLocal,
  loadMaster,
  pipeAnomalyReasons,
  resetAll,
  resolveConflict,
  runSync,
  saveLocal,
  setBaseTemp,
  setReportStatus,
  simulateRemoteChange,
} from "./store";
import type { EntityType, LocalState, SyncResult } from "./types";
import { fmtDateTime } from "./compensation";
import { StopsView } from "./views/StopsView";
import { PipesView } from "./views/PipesView";
import { ObservationsView } from "./views/ObservationsView";
import { AnomaliesView } from "./views/AnomaliesView";
import { ReportsView } from "./views/ReportsView";
import { SyncCenter } from "./views/SyncCenter";

type Tab = "pipes" | "stops" | "observations" | "anomalies" | "reports" | "sync";

const TABS: { key: Tab; label: string }[] = [
  { key: "pipes", label: "音管偏差" },
  { key: "stops", label: "音栓台账" },
  { key: "observations", label: "温湿度观测" },
  { key: "anomalies", label: "异常标记" },
  { key: "reports", label: "维护报告" },
  { key: "sync", label: "同步中心" },
];

export default function App() {
  const [s, setS] = useState<LocalState>(() => loadLocal());
  const [online, setOnline] = useState(true);
  const [weak, setWeak] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>("pipes");
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    saveLocal(s);
  }, [s]);

  const anomalyCount = useMemo(
    () => Object.values(s.pipes).filter((p) => pipeAnomalyReasons(s, p).length > 0).length,
    [s]
  );
  const latestObs = useMemo(() => {
    const sorted = Object.values(s.observations).sort(
      (a, b) => b.recordedAt.value - a.recordedAt.value
    );
    return sorted[0] ?? null;
  }, [s.observations]);

  const conflictCount = s.conflicts.filter((c) => c.status === "pending").length;
  const failedCount = Object.values(s.pipeSync).filter((st) => st === "failed").length;
  const outboxCount = s.outbox.length;
  const masterRevision = loadMaster().revision;

  const handleField = (entityType: EntityType, entityId: string, field: string, value: unknown) => {
    setS((prev) => editField(prev, entityType, entityId, field, value));
  };

  const handleSync = async () => {
    if (!online || syncing) return;
    setSyncing(true);
    await new Promise((r) => setTimeout(r, 450 + Math.random() * 600));
    const { state, result } = await runSync(s, { weakNetwork: weak });
    setS(state);
    setLastResult(result);
    setSyncing(false);
  };

  return (
    <main className="app">
      <header className="hero">
        <p>管风琴维护 · 离线续作 · 总档合并</p>
        <h1>管风琴音管调音续作台</h1>
        <span>
          音栓台账、音分偏差、温湿度观测与异常标记共用同一套补偿口径。断网照常登记，恢复后按「音管编号 +
          字段」合并回总档；两边改了同一字段就留两版等确认；基准温度一变，音分偏差立即作废重算，已确认报告退回待复核；上传失败只补没同步完的音管，重复回传不生成第二份记录。
        </span>
      </header>

      <section className="metrics">
        <article>
          <small>音栓数量</small>
          <strong>{Object.keys(s.stops).length}</strong>
        </article>
        <article>
          <small>偏差超限音管</small>
          <strong>{anomalyCount}</strong>
        </article>
        <article>
          <small>当前温度</small>
          <strong>{latestObs ? `${latestObs.temp.value}°C` : "—"}</strong>
        </article>
        <article>
          <small>当前湿度</small>
          <strong>{latestObs ? `${latestObs.humidity.value}%` : "—"}</strong>
        </article>
      </section>

      {!online && (
        <div className="banner banner-offline">
          弱网/离线登记中：改动保存在本机（{outboxCount} 项待回传）。恢复联网后到「同步中心」合并。
        </div>
      )}
      {conflictCount > 0 && (
        <div className="banner banner-conflict">
          有 {conflictCount} 个字段两版冲突，请到「同步中心」确认保留哪版。
        </div>
      )}
      {s.notice && (
        <div className="banner banner-notice">
          <span>
            基准温度已变更为 {s.notice.temp}°C（{fmtDateTime(s.notice.at)}）：音分偏差已按新口径重算，
            {s.notice.reverted} 份已确认报告退回待复核。
          </span>
          <button onClick={() => setS(dismissNotice(s))}>知道了</button>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tab tab-active" : "tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "sync" && (outboxCount > 0 || conflictCount > 0 || failedCount > 0) && (
              <span className="tab-badge">
                {failedCount > 0 ? failedCount : conflictCount > 0 ? conflictCount : outboxCount}
              </span>
            )}
            {t.key === "anomalies" && anomalyCount > 0 && (
              <span className="tab-badge">{anomalyCount}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "pipes" && <PipesView s={s} onField={handleField} />}
      {tab === "stops" && <StopsView s={s} />}
      {tab === "observations" && (
        <ObservationsView s={s} onAdd={(obs) => setS((prev) => addObservation(prev, obs))} />
      )}
      {tab === "anomalies" && <AnomaliesView s={s} onField={handleField} />}
      {tab === "reports" && (
        <ReportsView
          s={s}
          onAdd={(r) => setS((prev) => addReport(prev, r))}
          onStatus={(id, st) => setS((prev) => setReportStatus(prev, id, st))}
        />
      )}
      {tab === "sync" && (
        <SyncCenter
          s={s}
          online={online}
          weak={weak}
          syncing={syncing}
          lastResult={lastResult}
          onToggleOnline={() => setOnline((v) => !v)}
          onToggleWeak={() => setWeak((v) => !v)}
          onIdentity={(name) => setS((prev) => ({ ...prev, identity: name }))}
          onSync={handleSync}
          onResolve={(key, choice) => setS((prev) => resolveConflict(prev, key, choice))}
          onBaseTemp={(temp) => setS((prev) => setBaseTemp(prev, temp))}
          onSimulateRemote={() => setS((prev) => simulateRemoteChange(prev))}
          onReset={() => {
            const fresh = resetAll();
            setS(fresh);
            setLastResult(null);
          }}
          masterRevision={masterRevision}
        />
      )}
    </main>
  );
}
