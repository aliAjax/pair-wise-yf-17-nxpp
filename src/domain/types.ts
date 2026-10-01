// 领域类型：音管调音续作台

export type ReedStatus = "正常" | "簧片需微调" | "标记复检" | "需更换";

export type SyncStatus =
  | "pending" // 本地已登记，待回传
  | "syncing" // 回传中
  | "synced" // 已与总档一致
  | "failed" // 上传失败，待补传
  | "conflict"; // 存在字段冲突，待确认

/** 参与逐字段合并的音管字段（音管编号本身作为合并键，不在其内） */
export const PIPE_FIELDS = [
  "venue",
  "stopId",
  "pitch",
  "measuredCents",
  "obsTemp",
  "obsHumidity",
  "reedStatus",
  "note",
  "anomaly",
] as const;

export type PipeField = (typeof PIPE_FIELDS)[number];

export const FIELD_LABELS: Record<PipeField, string> = {
  venue: "场馆名称",
  stopId: "音栓",
  pitch: "音高",
  measuredCents: "实测音分",
  obsTemp: "观测温度",
  obsHumidity: "观测湿度",
  reedStatus: "簧片状态",
  note: "维修备注",
  anomaly: "异常标记",
};

/** 每个字段的版本信息：version 本地递增，syncedValue 为最近一次与总档一致的值（三方合并的基准） */
export interface FieldMeta {
  version: number;
  syncedValue: unknown;
}

export interface PipeRecord {
  pipeId: string;
  venue: string;
  stopId: string;
  pitch: string;
  measuredCents: number; // 实测音分（观测温度下的原始读数）
  obsTemp: number;
  obsHumidity: number;
  reedStatus: ReedStatus;
  note: string;
  anomaly: boolean;
  revision: number; // 本地每次有效修改 +1，用于幂等键
  fieldMeta: Record<PipeField, FieldMeta>;
  syncStatus: SyncStatus;
  updatedAt: number;
}

/** 登记表单提交的值 */
export type PipeFormValues = Pick<PipeRecord, "pipeId" | PipeField>;

export interface StopDef {
  id: string;
  name: string;
  category: "主音栓" | "簧片音栓" | "混合音栓" | "低音管";
  pipes: number;
}

export interface EnvObservation {
  id: string;
  venue: string;
  temp: number;
  humidity: number;
  at: number;
}

/** 同一字段两边都改过：保留两版，等确认 */
export interface ConflictItem {
  pipeId: string;
  field: PipeField;
  localValue: unknown;
  masterValue: unknown;
  baseValue: unknown;
}

export type ReportStatus = "draft" | "confirmed" | "pending_review";

export interface MaintenanceReport {
  id: string;
  venue: string;
  year: number;
  status: ReportStatus;
  baseTemp: number; // 生成时使用的基准温度
  generatedAt: number;
  confirmedAt?: number;
  totalPipes: number;
  anomalies: number;
  overLimit: number;
  avgAbsDeviation: number;
  note?: string;
}

/** 模拟总档（服务端）中的音管记录 */
export interface MasterPipe {
  pipeId: string;
  fields: Record<PipeField, unknown>;
  versions: Record<PipeField, number>;
  appliedKeys: string[]; // 已处理的幂等键，重复回传不生成第二份
  updatedAt: number;
}
