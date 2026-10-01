// 管风琴音管调音续作台 —— 核心数据类型
// 所有可合并字段均为 FieldMeta：值 + 时间戳 + 操作人 + opId（幂等去重键）

export type ID = string;

export type ReedState =
  | "normal"
  | "needs_tuning"
  | "needs_reed_work"
  | "out_of_service";

export type StopKind = "主音栓" | "簧片音栓" | "混合音栓" | "低音管";

export type FieldMeta<T> = {
  value: T;
  updatedAt: number;
  updatedBy: string;
  opId: string;
};

export type PipeRecord = {
  id: ID;                 // 音管编号（合并主键）
  stopId: ID;
  label: string;          // 音管编号显示名，如 C4
  pitch: string;          // 音高，如 C4
  // 可合并字段
  measuredCents: FieldMeta<number | null>;  // 实测音分偏差
  reedState: FieldMeta<ReedState>;
  notes: FieldMeta<string>;
  marked: FieldMeta<boolean>;               // 异常标记
  // 派生字段（由补偿口径计算，不参与字段合并）
  reducedCents: number | null;              // 折算到基准条件的音分偏差
  reducedStale: boolean;                    // 基准温度变更后标记作废
  compVersion: number;                       // 计算时所用基准温度版本
};

export type StopRecord = {
  id: ID;
  name: string;
  kind: StopKind;
  venue: string;
  pipeIds: ID[];
};

export type Observation = {
  id: ID;
  venue: FieldMeta<string>;
  temp: FieldMeta<number>;
  humidity: FieldMeta<number>;
  recordedAt: FieldMeta<number>;
  recordedBy: FieldMeta<string>;
  note: FieldMeta<string>;
};

export type ReportStatus = "draft" | "pending_review" | "confirmed";

export type MaintenanceReport = {
  id: ID;
  venue: FieldMeta<string>;
  title: FieldMeta<string>;
  date: FieldMeta<number>;
  tuners: FieldMeta<string[]>;
  pipeIds: FieldMeta<ID[]>;
  status: FieldMeta<ReportStatus>;
  summary: FieldMeta<string>;
  baseTempAtConfirm: number | null;  // 系统快照：确认时的基准温度
};

export type EntityType = "pipe" | "stop" | "observation" | "report" | "meta";

export type OutboxOp = {
  opId: string;
  entityType: EntityType;
  entityId: ID;
  field: string;
  value: unknown;
  updatedAt: number;
  updatedBy: string;
};

export type Version = {
  value: unknown;
  updatedAt: number;
  updatedBy: string;
  opId: string;
};

export type Conflict = {
  key: string;            // entityType:entityId:field
  label: string;
  local: Version;
  remote: Version;
  status: "pending" | "resolved_local" | "resolved_remote";
};

export type SyncLogEntry = {
  id: string;
  at: number;
  kind: "info" | "success" | "warning" | "error";
  message: string;
};

export type PipeSyncState = "synced" | "pending" | "failed";

export type CascadeNotice = {
  temp: number;
  reverted: number;
  at: number;
} | null;

export type LocalState = {
  identity: string;
  pipes: Record<ID, PipeRecord>;
  stops: Record<ID, StopRecord>;
  observations: Record<ID, Observation>;
  reports: Record<ID, MaintenanceReport>;
  baseTemp: number;
  appliedOpIds: ID[];                       // 已回传总档的 opId（去重）
  syncedOpIds: Record<string, string>;      // fieldKey -> 上次同步时的 opId
  outbox: OutboxOp[];
  conflicts: Conflict[];
  pipeSync: Record<ID, PipeSyncState>;
  lastSyncAt: number | null;
  compVersion: number;
  notice: CascadeNotice;
  logs: SyncLogEntry[];
};

export type MasterState = {
  pipes: Record<ID, PipeRecord>;
  stops: Record<ID, StopRecord>;
  observations: Record<ID, Observation>;
  reports: Record<ID, MaintenanceReport>;
  baseTemp: number;
  appliedOpIds: ID[];
  revision: number;
};

export type SyncResult = {
  pulled: number;
  pushed: number;
  duplicates: number;
  conflicts: number;
  failedBatches: string[];
  adoptedBaseTemp: number | null;
};
