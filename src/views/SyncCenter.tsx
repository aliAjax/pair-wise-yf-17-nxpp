import { useState } from "react";
import type { LocalState, SyncResult } from "../types";
import { fmtDateTime } from "../compensation";
import { fieldName, formatFieldValue } from "../store";
import { Badge, SectionTitle } from "./ui";

type Props = {
  s: LocalState;
  online: boolean;
  weak: boolean;
  syncing: boolean;
  lastResult: SyncResult | null;
  onToggleOnline: () => void;
  onToggleWeak: () => void;
  onIdentity: (name: string) => void;
  onSync: () => void;
  onResolve: (key: string, choice: "local" | "remote") => void;
  onBaseTemp: (temp: number) => void;
  onSimulateRemote: () => void;
  onReset: () => void;
  masterRevision: number;
};

function versionLabel(v: { value: unknown; updatedBy: string; updatedAt: number }, field: string) {
  return `${v.updatedBy} · ${fmtDateTime(v.updatedAt)}`;
}

export function SyncCenter({
  s,
  online,
  weak,
  syncing,
  lastResult,
  onToggleOnline,
  onToggleWeak,
  onIdentity,
  onSync,
  onResolve,
  onBaseTemp,
  onSimulateRemote,
  onReset,
  masterRevision,
}: Props) {
  const [tempInput, setTempInput] = useState(s.baseTemp);
  const pendingConflicts = s.conflicts.filter((c) => c.status === "pending");
  const failedPipes = Object.entries(s.pipeSync).filter(([, st]) => st === "failed");
  const pendingOps = s.outbox.filter((o) => o.entityType !== "meta");
  const metaPending = s.outbox.some((o) => o.entityType === "meta");

  return (
    <section className="panel">
      <SectionTitle
        eyebrow="续作台同步中心"
        title="离线登记与总档合并"
        extra={
          <div className="chips">
            <button onClick={onToggleOnline} className={online ? "chip-online" : "chip-offline"}>
              {online ? "● 在线" : "○ 离线"}
            </button>
            <button onClick={onToggleWeak} className={weak ? "chip-active" : ""}>
              {weak ? "弱网模拟：开" : "弱网模拟：关"}
            </button>
          </div>
        }
      />

      {!online && (
        <div className="banner banner-offline">
          当前离线：所有登记只保存在本机（{s.outbox.length} 项待回传）。恢复联网后点「立即同步」，
          按「音管编号 + 字段」合并回总档；两边改了同一字段会保留两版等确认。
        </div>
      )}

      <div className="sync-grid">
        <div className="sync-card">
          <h3>网络与身份</h3>
          <label>
            <span>本机调音师身份</span>
            <select value={s.identity} onChange={(e) => onIdentity(e.target.value)}>
              <option value="调音师甲">调音师甲</option>
              <option value="调音师乙">调音师乙</option>
            </select>
          </label>
          <button className="primary sync-btn" onClick={onSync} disabled={!online || syncing}>
            {syncing ? "同步中……" : "立即同步（合并总档）"}
          </button>
          <button onClick={onSimulateRemote} disabled={!online}>
            模拟调音师乙在总档改了一根音管
          </button>
          <p className="hint">
            上次同步：{s.lastSyncAt ? fmtDateTime(s.lastSyncAt) : "尚未同步"}
          </p>
          {lastResult && (
            <p className="hint">
              最近一次：回传 {lastResult.pushed} 条（去重 {lastResult.duplicates} 条），拉取{" "}
              {lastResult.pulled} 条，冲突 {lastResult.conflicts} 条，失败{" "}
              {lastResult.failedBatches.length} 批。
            </p>
          )}
        </div>

        <div className="sync-card">
          <h3>待补传（上传失败保住的部分）</h3>
          {failedPipes.length === 0 ? (
            <p className="hint">没有失败的音管。弱网开启时同步会随机丢批，已完成的音管不会重传。</p>
          ) : (
            <>
              <p className="hint">
                {failedPipes.length} 根音管上传失败，记录已保存在本机，恢复后只补传这些音管：
              </p>
              <div className="chips">
                {failedPipes.map(([id]) => (
                  <Badge key={id} cls="badge-failed">
                    {s.pipes[id]?.label ?? id}
                  </Badge>
                ))}
              </div>
              <button className="primary" onClick={onSync} disabled={!online || syncing}>
                只补传未同步完的音管
              </button>
            </>
          )}
          <h3 className="mt">待回传字段</h3>
          {pendingOps.length === 0 && !metaPending ? (
            <p className="hint">本机改动均已回传。</p>
          ) : (
            <ul className="outbox-list">
              {metaPending && (
                <li>
                  <Badge cls="badge-pending">基准温度</Badge> 基准温度 → {s.baseTemp}°C
                </li>
              )}
              {pendingOps.slice(0, 12).map((o) => (
                <li key={o.opId}>
                  <Badge cls="badge-pending">{fieldName(o.field)}</Badge>{" "}
                  {o.entityType}:{o.entityId} = {formatFieldValue(o.field, o.value)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sync-card">
          <h3>基准温度（全档统一补偿口径）</h3>
          <label>
            <span>基准温度（°C）</span>
            <input
              type="number"
              step="0.5"
              value={tempInput}
              onChange={(e) => setTempInput(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => onBaseTemp(tempInput)}
            disabled={tempInput === s.baseTemp}
          >
            应用并作废重算
          </button>
          <p className="hint">
            变更后：音分偏差立即按新口径重算（作废旧值），已确认的维护报告退回待复核。音栓台账与温湿度观测共用此口径。
          </p>
        </div>

        <div className="sync-card">
          <h3>总档状态</h3>
          <p className="hint">
            总档修订号：<b>#{masterRevision}</b>
          </p>
          <p className="hint">
            已应用 opId：<b>{s.appliedOpIds.length}</b> 条（重复回传会被去重，不生成第二份记录）
          </p>
          <button onClick={onReset}>重置演示数据</button>
        </div>
      </div>

      <h3 className="conflict-title">两版冲突（等确认）</h3>
      {pendingConflicts.length === 0 ? (
        <p className="hint">没有待确认的冲突。两边改了同一字段时，这里会列出本地版与总档版。</p>
      ) : (
        <div className="conflict-list">
          {pendingConflicts.map((c) => (
            <article key={c.key} className="conflict-card">
              <h4>{c.label}</h4>
              <div className="versions">
                <div className="version version-local">
                  <Badge cls="badge-accent">本地版</Badge>
                  <p className="version-value">{formatFieldValue(c.key.split(":")[2], c.local.value)}</p>
                  <p className="hint">{versionLabel(c.local, c.key.split(":")[2])}</p>
                </div>
                <div className="version version-remote">
                  <Badge cls="badge-kind">总档版</Badge>
                  <p className="version-value">{formatFieldValue(c.key.split(":")[2], c.remote.value)}</p>
                  <p className="hint">{versionLabel(c.remote, c.key.split(":")[2])}</p>
                </div>
              </div>
              <div className="row-actions">
                <button className="primary" onClick={() => onResolve(c.key, "local")}>
                  保留本地版（回传总档）
                </button>
                <button onClick={() => onResolve(c.key, "remote")}>采用总档版</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3 className="conflict-title">同步日志</h3>
      <div className="log-list">
        {s.logs.map((log) => (
          <p key={log.id} className={`log-line log-${log.kind}`}>
            <span className="log-time">{fmtDateTime(log.at)}</span> {log.message}
          </p>
        ))}
      </div>
    </section>
  );
}
