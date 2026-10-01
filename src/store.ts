// 续作台引擎：离线登记 + 联网合并
//
// 合并规则：以「音管编号(实体) + 字段」为最小合并单元。
//  - 仅本地改过 → 回传总档
//  - 仅总档改过 → 快进采用
//  - 两边都改了同一字段 → 保留两版（冲突），等调音师确认
//  - 回传带 opId，总档 appliedOpIds 去重，重复回传不生成第二份记录
//  - 上传按音管分批：失败的音管保留待补传，恢复后只补没同步完的音管
import { COMPENSATION, fmtCents, fmtDateTime } from "./compensation";
import { buildSeed } from "./seed";
import type {
  Conflict,
  EntityType,
  LocalState,
  MasterState,
  OutboxOp,
  PipeRecord,
  PipeSyncState,
  ReedState,
  ReportStatus,
  SyncResult,
} from "./types";

const LOCAL_KEY = "organ-console-local-v1";
const MASTER_KEY = "organ-console-master-v1";

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function fieldKey(et: EntityType, id: string, f: string): string {
  return `${et}:${id}:${f}`;
}

const PLURAL: Record<
  Exclude<EntityType, "meta">,
  "pipes" | "stops" | "observations" | "reports"
> = {
  pipe: "pipes",
  stop: "stops",
  observation: "observations",
  report: "reports",
};

const FIELDS: Partial<Record<EntityType, string[]>> = {
  pipe: ["measuredCents", "reedState", "notes", "marked"],
  stop: ["name", "kind", "venue"],
  observation: ["venue", "temp", "humidity", "recordedAt", "recordedBy", "note"],
  report: ["venue", "title", "date", "tuners", "pipeIds", "status", "summary"],
};

const FIELD_NAMES: Record<string, string> = {
  measuredCents: "实测音分偏差",
  reedState: "簧片状态",
  notes: "维修备注",
  marked: "异常标记",
  name: "名称",
  kind: "类型",
  venue: "场馆",
  temp: "温度",
  humidity: "湿度",
  recordedAt: "观测时间",
  recordedBy: "记录人",
  note: "备注",
  title: "标题",
  date: "日期",
  tuners: "调音师",
  pipeIds: "维护音管",
  status: "报告状态",
  summary: "报告摘要",
  baseTemp: "基准温度",
};

export function fieldName(f: string): string {
  return FIELD_NAMES[f] ?? f;
}

export function formatFieldValue(field: string, value: unknown): string {
  switch (field) {
    case "measuredCents":
      return value == null ? "未填" : `${fmtCents(value as number)} 音分`;
    case "reedState":
      return REED_LABELS[value as ReedState] ?? String(value);
    case "marked":
      return value ? "是（已标记复检）" : "否";
    case "status":
      return REPORT_STATUS_LABELS[value as ReportStatus] ?? String(value);
    case "temp":
      return `${value} °C`;
    case "humidity":
      return `${value} %RH`;
    case "recordedAt":
    case "date":
      return fmtDateTime(value as number);
    case "tuners":
    case "pipeIds":
      return Array.isArray(value) && value.length ? value.join("、") : "—";
    default:
      return value == null || value === "" ? "—" : String(value);
  }
}

// ---------- 持久化 ----------

export function loadMaster(): MasterState {
  try {
    const raw = localStorage.getItem(MASTER_KEY);
    if (raw) return JSON.parse(raw) as MasterState;
  } catch {
    /* fallthrough */
  }
  const { master } = buildSeed();
  localStorage.setItem(MASTER_KEY, JSON.stringify(master));
  return master;
}

export function loadLocal(): LocalState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as LocalState;
  } catch {
    /* fallthrough */
  }
  const { local } = buildSeed();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  return local;
}

export function saveLocal(s: LocalState): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
}

export function saveMaster(m: MasterState): void {
  localStorage.setItem(MASTER_KEY, JSON.stringify(m));
}

export function resetAll(): LocalState {
  localStorage.removeItem(LOCAL_KEY);
  localStorage.removeItem(MASTER_KEY);
  const { local } = buildSeed();
  saveMaster(buildSeed().master);
  saveLocal(local);
  return local;
}

// ---------- 派生计算 ----------

export function latestObservation(
  s: LocalState | MasterState,
  venue: string
): { temp: number; humidity: number } {
  let best: { at: number; temp: number; humidity: number } | null = null;
  for (const o of Object.values(s.observations)) {
    if (o.venue.value !== venue) continue;
    const at = o.recordedAt.value;
    if (!best || at > best.at) {
      best = { at, temp: o.temp.value, humidity: o.humidity.value };
    }
  }
  return best
    ? { temp: best.temp, humidity: best.humidity }
    : { temp: 20, humidity: COMPENSATION.baseHumidity };
}

export function obsForPipe(
  s: LocalState | MasterState,
  pipe: PipeRecord
): { temp: number; humidity: number } {
  const stop = s.stops[pipe.stopId];
  if (!stop) return { temp: 20, humidity: COMPENSATION.baseHumidity };
  return latestObservation(s, stop.venue);
}

// 重算单根音管的折算偏差（实测 − 温湿度补偿）
function recomputePipe(s: LocalState, pipeId: string): void {
  const pipe = s.pipes[pipeId];
  if (!pipe) return;
  const obs = obsForPipe(s, pipe);
  const measured = pipe.measuredCents.value;
  if (measured == null) {
    pipe.reducedCents = null;
  } else {
    pipe.reducedCents =
      Math.round(
        COMPENSATION.reducedDeviation(measured, obs.temp, obs.humidity, s.baseTemp) * 10
      ) / 10;
  }
  pipe.reducedStale = false;
  pipe.compVersion = s.baseTemp;
}

function recomputeAllPipes(s: LocalState): void {
  for (const id of Object.keys(s.pipes)) recomputePipe(s, id);
}

// ---------- 本地编辑（离线可用） ----------

export function editField(
  s: LocalState,
  entityType: EntityType,
  entityId: string,
  field: string,
  value: unknown
): LocalState {
  const next = structuredClone(s);
  const opId = uid();
  const meta = { value, updatedAt: Date.now(), updatedBy: next.identity, opId };

  if (entityType === "meta") {
    next.baseTemp = value as number;
  } else {
    const plural = PLURAL[entityType] as "pipes";
    const ent = (next[plural] as Record<string, unknown>)[entityId] as
      | Record<string, unknown>
      | undefined;
    if (!ent) return s;
    ent[field] = meta;
  }

  next.outbox = next.outbox.filter(
    (o) =>
      !(
        o.entityType === entityType &&
        o.entityId === entityId &&
        o.field === field
      )
  );
  next.outbox.push({
    opId,
    entityType,
    entityId,
    field,
    value,
    updatedAt: meta.updatedAt,
    updatedBy: next.identity,
  });

  if (entityType === "pipe") {
    next.pipeSync[entityId] = "pending";
    recomputePipe(next, entityId);
  }
  return next;
}

export function addObservation(
  s: LocalState,
  obs: { venue: string; temp: number; humidity: number; note: string }
): LocalState {
  const next = structuredClone(s);
  const id = `obs-${uid()}`;
  const at = Date.now();
  const mk = <T,>(v: T) => ({ value: v, updatedAt: at, updatedBy: next.identity, opId: uid() });
  const observation = {
    id,
    venue: mk(obs.venue),
    temp: mk(obs.temp),
    humidity: mk(obs.humidity),
    recordedAt: mk(at),
    recordedBy: mk(next.identity),
    note: mk(obs.note),
  };
  next.observations[id] = observation;
  for (const f of FIELDS.observation!) {
    const m = (observation as unknown as Record<string, { opId: string }>)[f];
    next.outbox.push({
      opId: m.opId,
      entityType: "observation",
      entityId: id,
      field: f,
      value: (observation as unknown as Record<string, { value: unknown }>)[f].value,
      updatedAt: at,
      updatedBy: next.identity,
    });
  }
  // 新观测可能改变补偿口径，重算该场馆音管
  for (const p of Object.values(next.pipes)) {
    const stop = next.stops[p.stopId];
    if (stop?.venue === obs.venue) recomputePipe(next, p.id);
  }
  return next;
}

export function addReport(
  s: LocalState,
  r: { venue: string; title: string; date: number; tuners: string[]; pipeIds: string[]; summary: string }
): LocalState {
  const next = structuredClone(s);
  const id = `report-${uid()}`;
  const at = Date.now();
  const mk = <T,>(v: T) => ({ value: v, updatedAt: at, updatedBy: next.identity, opId: uid() });
  const report = {
    id,
    venue: mk(r.venue),
    title: mk(r.title),
    date: mk(r.date),
    tuners: mk(r.tuners),
    pipeIds: mk(r.pipeIds),
    status: mk<ReportStatus>("draft"),
    summary: mk(r.summary),
    baseTempAtConfirm: null,
  };
  next.reports[id] = report;
  for (const f of FIELDS.report!) {
    const m = (report as unknown as Record<string, { opId: string }>)[f];
    next.outbox.push({
      opId: m.opId,
      entityType: "report",
      entityId: id,
      field: f,
      value: (report as unknown as Record<string, { value: unknown }>)[f].value,
      updatedAt: at,
      updatedBy: next.identity,
    });
  }
  return next;
}

// 基准温度变更：作废重算 + 报告退回待复核（本地与总档共用同一套级联，opId 确定）
function cascadeReports(
  reports: Record<string, MaintenanceReportLike>,
  temp: number
): number {
  let reverted = 0;
  for (const r of Object.values(reports)) {
    if (r.status.value === "confirmed") {
      r.status = {
        value: "pending_review",
        updatedAt: Date.now(),
        updatedBy: "系统（基准温度变更）",
        opId: `cascade-${temp}-${r.id}`,
      };
      reverted += 1;
    }
  }
  return reverted;
}

type MaintenanceReportLike = {
  id: string;
  status: { value: ReportStatus; updatedAt: number; updatedBy: string; opId: string };
};

export function applyBaseTempChange(next: LocalState, temp: number): number {
  next.baseTemp = temp;
  next.compVersion += 1;
  for (const p of Object.values(next.pipes)) {
    p.reducedStale = true; // 先标记作废
  }
  recomputeAllPipes(next);
  const reverted = cascadeReports(
    next.reports as unknown as Record<string, MaintenanceReportLike>,
    temp
  );
  for (const r of Object.values(next.reports)) {
    if (r.status.opId.startsWith("cascade-")) {
      next.outbox = next.outbox.filter(
        (o) => !(o.entityType === "report" && o.entityId === r.id && o.field === "status")
      );
      next.outbox.push({
        opId: r.status.opId,
        entityType: "report",
        entityId: r.id,
        field: "status",
        value: "pending_review",
        updatedAt: r.status.updatedAt,
        updatedBy: r.status.updatedBy,
      });
    }
  }
  next.notice = { temp, reverted, at: Date.now() };
  next.logs.unshift({
    id: uid(),
    at: Date.now(),
    kind: "warning",
    message: `基准温度变更为 ${temp}°C：${Object.keys(next.pipes).length} 根音管的音分偏差已按新补偿口径作废重算，${reverted} 份已确认报告退回待复核。`,
  });
  return reverted;
}

export function setBaseTemp(s: LocalState, temp: number): LocalState {
  const next = structuredClone(s);
  next.outbox = next.outbox.filter(
    (o) => !(o.entityType === "meta" && o.field === "baseTemp")
  );
  const opId = uid();
  next.outbox.push({
    opId,
    entityType: "meta",
    entityId: "baseTemp",
    field: "baseTemp",
    value: temp,
    updatedAt: Date.now(),
    updatedBy: next.identity,
  });
  applyBaseTempChange(next, temp);
  return next;
}

export function setReportStatus(
  s: LocalState,
  reportId: string,
  status: ReportStatus
): LocalState {
  const next = structuredClone(s);
  const r = next.reports[reportId];
  if (!r) return s;
  const opId = uid();
  r.status = { value: status, updatedAt: Date.now(), updatedBy: next.identity, opId };
  if (status === "confirmed") r.baseTempAtConfirm = next.baseTemp;
  next.outbox = next.outbox.filter(
    (o) => !(o.entityType === "report" && o.entityId === reportId && o.field === "status")
  );
  next.outbox.push({
    opId,
    entityType: "report",
    entityId: reportId,
    field: "status",
    value: status,
    updatedAt: r.status.updatedAt,
    updatedBy: next.identity,
  });
  return next;
}

// ---------- 冲突处理 ----------

export function resolveConflict(
  s: LocalState,
  key: string,
  choice: "local" | "remote"
): LocalState {
  const next = structuredClone(s);
  const c = next.conflicts.find((x) => x.key === key);
  if (!c || c.status !== "pending") return s;
  c.status = choice === "local" ? "resolved_local" : "resolved_remote";
  const [et, eid, field] = key.split(":") as [EntityType, string, string];

  if (choice === "remote") {
    // 采用总档版本
    if (et !== "meta") {
      const plural = PLURAL[et] as "pipes";
      const ent = (next[plural] as Record<string, unknown>)[eid] as
        | Record<string, unknown>
        | undefined;
      if (ent) {
        ent[field] = { ...c.remote };
        next.syncedOpIds[key] = c.remote.opId;
        next.outbox = next.outbox.filter(
          (o) => !(o.entityType === et && o.entityId === eid && o.field === field)
        );
        if (et === "pipe") {
          next.pipeSync[eid] = "synced";
          recomputePipe(next, eid);
        }
      }
    }
  } else {
    // 保留本地版本：随下次回传上总档
    if (et === "pipe") {
      next.pipeSync[eid] = "pending";
      recomputePipe(next, eid);
    }
  }
  next.logs.unshift({
    id: uid(),
    at: Date.now(),
    kind: "info",
    message: `冲突已处理（${c.label}）：${choice === "local" ? "保留本地版本，待回传总档" : "采用总档版本"}。`,
  });
  return next;
}

export function dismissNotice(s: LocalState): LocalState {
  return { ...s, notice: null };
}

// ---------- 模拟他人改动总档（制造真实冲突） ----------

export function simulateRemoteChange(s: LocalState): LocalState {
  const m = loadMaster();
  const pipeIds = Object.keys(m.pipes);
  const id = pipeIds[Math.floor(Math.random() * pipeIds.length)];
  const pipe = m.pipes[id];
  const field = (["measuredCents", "notes", "reedState"] as const)[
    Math.floor(Math.random() * 3)
  ];
  const opId = uid();
  const by = "调音师乙";
  const at = Date.now();
  if (field === "measuredCents") {
    const cur = pipe.measuredCents.value ?? 0;
    pipe.measuredCents = {
      value: Math.round((cur + (Math.random() * 6 - 3)) * 10) / 10,
      updatedAt: at,
      updatedBy: by,
      opId,
    };
  } else if (field === "notes") {
    const notes = ["簧片需微调", "正常", "标记复检", "音色偏亮", "待下次维护确认"];
    pipe.notes = {
      value: notes[Math.floor(Math.random() * notes.length)],
      updatedAt: at,
      updatedBy: by,
      opId,
    };
  } else {
    const states: ReedState[] = ["normal", "needs_tuning", "needs_reed_work"];
    pipe.reedState = {
      value: states[Math.floor(Math.random() * states.length)],
      updatedAt: at,
      updatedBy: by,
      opId,
    };
  }
  m.appliedOpIds.push(opId);
  m.revision += 1;
  saveMaster(m);

  const next = structuredClone(s);
  next.logs.unshift({
    id: uid(),
    at: at,
    kind: "info",
    message: `总档收到 ${by} 对音管 ${pipe.label} 的「${fieldName(field)}」改动，下次同步时按字段合并。`,
  });
  return next;
}

// ---------- 同步 ----------

function removeOutbox(next: LocalState, key: string): void {
  const [et, eid, f] = key.split(":") as [EntityType, string, string];
  next.outbox = next.outbox.filter(
    (o) => !(o.entityType === et && o.entityId === eid && o.field === f)
  );
}

function labelFor(et: EntityType, rid: string, f: string, ent: unknown): string {
  if (et === "pipe") {
    const p = ent as PipeRecord;
    return `音管 ${p.label}（${rid}）· ${fieldName(f)}`;
  }
  if (et === "report") {
    const r = ent as { title?: { value: string } };
    return `报告「${r.title?.value ?? rid}」· ${fieldName(f)}`;
  }
  if (et === "observation") return `温湿度观测 ${rid} · ${fieldName(f)}`;
  return `${rid} · ${fieldName(f)}`;
}

function applyOpToMaster(m: MasterState, op: OutboxOp, local: LocalState): void {
  if (op.entityType === "meta") {
    m.baseTemp = op.value as number;
    // 总档口径变更：已确认报告同样退回待复核
    cascadeReports(
      m.reports as unknown as Record<string, MaintenanceReportLike>,
      m.baseTemp
    );
    return;
  }
  const plural = PLURAL[op.entityType] as "pipes";
  const map = m[plural] as Record<string, Record<string, unknown>>;
  if (!map[op.entityId]) {
    // 离线新建的实体：从本地克隆，保证实体级记录只创建一次
    const localMap = local[plural] as Record<string, Record<string, unknown>>;
    if (localMap[op.entityId]) map[op.entityId] = structuredClone(localMap[op.entityId]);
  }
  const ent = map[op.entityId];
  if (ent) {
    ent[op.field] = {
      value: op.value,
      updatedAt: op.updatedAt,
      updatedBy: op.updatedBy,
      opId: op.opId,
    };
  }
}

export async function runSync(
  s: LocalState,
  opts: { weakNetwork: boolean }
): Promise<{ state: LocalState; result: SyncResult }> {
  const next = structuredClone(s);
  const m = loadMaster();
  const result: SyncResult = {
    pulled: 0,
    pushed: 0,
    duplicates: 0,
    conflicts: 0,
    failedBatches: [],
    adoptedBaseTemp: null,
  };

  // ===== 拉取：按「实体 + 字段」合并 =====
  (["pipe", "stop", "observation", "report"] as Exclude<EntityType, "meta">[]).forEach((et) => {
    const plural = PLURAL[et] as "pipes";
    const remoteMap = m[plural] as Record<string, Record<string, unknown>>;
    const localMap = next[plural] as Record<string, Record<string, unknown>>;
    for (const [rid, remoteEnt] of Object.entries(remoteMap)) {
      const localEnt = localMap[rid];
      if (!localEnt) {
        localMap[rid] = structuredClone(remoteEnt);
        for (const f of FIELDS[et]!) {
          const meta = remoteEnt[f] as { opId: string } | undefined;
          if (meta) next.syncedOpIds[fieldKey(et, rid, f)] = meta.opId;
        }
        result.pulled += 1;
        if (et === "pipe") {
          next.pipeSync[rid] = "synced";
          recomputePipe(next, rid);
        }
        continue;
      }
      for (const f of FIELDS[et]!) {
        const rMeta = remoteEnt[f] as
          | { value: unknown; opId: string; updatedAt: number; updatedBy: string }
          | undefined;
        const lMeta = localEnt[f] as
          | { value: unknown; opId: string; updatedAt: number; updatedBy: string }
          | undefined;
        if (!rMeta || !lMeta) continue;
        const key = fieldKey(et, rid, f);
        const lastSynced = next.syncedOpIds[key];
        if (rMeta.opId === lastSynced) continue; // 总档未变
        if (lMeta.opId === lastSynced) {
          // 本地未变 → 快进采用总档
          localEnt[f] = structuredClone(rMeta);
          next.syncedOpIds[key] = rMeta.opId;
          removeOutbox(next, key);
          result.pulled += 1;
          if (et === "pipe") {
            next.pipeSync[rid] = "synced";
            recomputePipe(next, rid);
          }
        } else if (JSON.stringify(rMeta.value) === JSON.stringify(lMeta.value)) {
          next.syncedOpIds[key] = rMeta.opId;
          removeOutbox(next, key);
        } else if (
          !next.conflicts.some((c) => c.key === key && c.status === "pending")
        ) {
          // 两边都改了同一字段 → 留两版等确认
          const conflict: Conflict = {
            key,
            label: labelFor(et, rid, f, localEnt),
            local: {
              value: lMeta.value,
              updatedAt: (lMeta as { updatedAt: number }).updatedAt,
              updatedBy: (lMeta as { updatedBy: string }).updatedBy,
              opId: lMeta.opId,
            },
            remote: {
              value: rMeta.value,
              updatedAt: (rMeta as { updatedAt: number }).updatedAt,
              updatedBy: (rMeta as { updatedBy: string }).updatedBy,
              opId: rMeta.opId,
            },
            status: "pending",
          };
          next.conflicts.push(conflict);
          result.conflicts += 1;
        }
      }
    }
  });

  // ===== 拉取基准温度（总档口径优先） =====
  const metaPending = next.outbox.some((o) => o.entityType === "meta");
  if (!metaPending && m.baseTemp !== next.baseTemp) {
    next.baseTemp = m.baseTemp;
    next.compVersion += 1;
    for (const p of Object.values(next.pipes)) p.reducedStale = true;
    recomputeAllPipes(next);
    const reverted = cascadeReports(
      m.reports as unknown as Record<string, MaintenanceReportLike>,
      m.baseTemp
    );
    // 本地与总档保持同一版级联结果（相同 opId）
    for (const [rid, r] of Object.entries(next.reports)) {
      if (m.reports[rid] && r.status.value === "confirmed") {
        r.status = structuredClone(m.reports[rid].status);
        // 级联优先：撤销本地未推送的确认操作，避免把报告又确认回去
        next.outbox = next.outbox.filter(
          (o) => !(o.entityType === "report" && o.entityId === rid && o.field === "status")
        );
      }
    }
    next.notice = { temp: m.baseTemp, reverted, at: Date.now() };
    next.logs.unshift({
      id: uid(),
      at: Date.now(),
      kind: "warning",
      message: `总档基准温度为 ${m.baseTemp}°C：音分偏差已按新口径作废重算，${reverted} 份已确认报告退回待复核。`,
    });
    result.adoptedBaseTemp = m.baseTemp;
  }

  // ===== 推送：按音管（实体）分批，失败只留待补传 =====
  const batches = new Map<string, OutboxOp[]>();
  for (const op of next.outbox) {
    const bk =
      op.entityType === "meta"
        ? "meta"
        : `${op.entityType}:${op.entityId}`;
    if (!batches.has(bk)) batches.set(bk, []);
    batches.get(bk)!.push(op);
  }

  for (const [bk, ops] of batches) {
    const pipeId = bk.startsWith("pipe:") ? bk.slice(5) : null;
    if (opts.weakNetwork && Math.random() < 0.45) {
      // 弱网：这批没传上去，已完成的其他批不受影响
      if (pipeId) next.pipeSync[pipeId] = "failed";
      result.failedBatches.push(bk);
      continue;
    }
    for (const op of ops) {
      if (m.appliedOpIds.includes(op.opId)) {
        result.duplicates += 1; // 幂等去重：重复回传不生成第二份记录
        continue;
      }
      applyOpToMaster(m, op, next);
      m.appliedOpIds.push(op.opId);
      result.pushed += 1;
    }
    for (const op of ops) {
      const key = fieldKey(op.entityType, op.entityId, op.field);
      next.syncedOpIds[key] = op.opId;
      next.outbox = next.outbox.filter((o) => o.opId !== op.opId);
    }
    if (pipeId) next.pipeSync[pipeId] = "synced";
    m.revision += 1;
  }

  // 推送后若总档基准温度被本地更新，本地无需再动（编辑时已重算）
  saveMaster(m);

  next.lastSyncAt = Date.now();
  const failed = result.failedBatches.length;
  next.logs.unshift({
    id: uid(),
    at: Date.now(),
    kind: failed ? "warning" : "success",
    message: `同步完成：回传 ${result.pushed} 条（去重 ${result.duplicates} 条），拉取 ${result.pulled} 条，冲突 ${result.conflicts} 条，失败待补 ${failed} 批。`,
  });

  return { state: next, result };
}

// ---------- 展示辅助 ----------

export const REED_LABELS: Record<ReedState, string> = {
  normal: "正常",
  needs_tuning: "需微调",
  needs_reed_work: "需修簧",
  out_of_service: "停用",
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: "草稿",
  pending_review: "待复核",
  confirmed: "已确认",
};

export function pipeAnomalyReasons(
  s: LocalState,
  pipe: PipeRecord
): string[] {
  const reasons: string[] = [];
  if (pipe.marked.value) reasons.push("人工标记复检");
  if (pipe.reducedCents != null && Math.abs(pipe.reducedCents) > 10)
    reasons.push("折算偏差超限（>±10 音分）");
  if (pipe.reedState.value !== "normal")
    reasons.push(`簧片状态：${REED_LABELS[pipe.reedState.value]}`);
  void s;
  return reasons;
}

export function syncBadge(state: PipeSyncState | undefined): {
  text: string;
  cls: string;
} {
  switch (state) {
    case "synced":
      return { text: "已同步", cls: "badge-synced" };
    case "pending":
      return { text: "待同步", cls: "badge-pending" };
    case "failed":
      return { text: "上传失败·待补传", cls: "badge-failed" };
    default:
      return { text: "已同步", cls: "badge-synced" };
  }
}
