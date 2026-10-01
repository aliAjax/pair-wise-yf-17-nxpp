// 种子数据：本地工作台与模拟总档共用同一份定义，保证初始状态一致

import { DEFAULT_BASE_TEMP, compensateCents, DEVIATION_LIMIT_CENTS } from "./compensation";
import {
  PIPE_FIELDS,
  type EnvObservation,
  type FieldMeta,
  type MaintenanceReport,
  type MasterPipe,
  type PipeField,
  type PipeFormValues,
  type PipeRecord,
  type StopDef,
  type SyncStatus,
} from "./types";

export const VENUES = ["St.Mary", "ConcertHall A", "Abbey Room"];

export const STOPS: StopDef[] = [
  { id: "st-trumpet8", name: "Trumpet 8'", category: "簧片音栓", pipes: 61 },
  { id: "st-principal4", name: "Principal 4'", category: "主音栓", pipes: 61 },
  { id: "st-bourdon16", name: "Bourdon 16'", category: "低音管", pipes: 32 },
  { id: "st-mixture4", name: "Mixture IV", category: "混合音栓", pipes: 244 },
  { id: "st-gedackt8", name: "Gedackt 8'", category: "主音栓", pipes: 61 },
];

/** 已在总档中的音管（本地与总档一致） */
const SYNCED_SEEDS: PipeFormValues[] = [
  {
    pipeId: "TRP8-CS4",
    venue: "St.Mary",
    stopId: "st-trumpet8",
    pitch: "C#4",
    measuredCents: 9,
    obsTemp: 24,
    obsHumidity: 58,
    reedStatus: "簧片需微调",
    note: "簧片需微调，下周复查",
    anomaly: false,
  },
  {
    pipeId: "PRI4-G3",
    venue: "ConcertHall A",
    stopId: "st-principal4",
    pitch: "G3",
    measuredCents: -3,
    obsTemp: 20,
    obsHumidity: 50,
    reedStatus: "正常",
    note: "正常",
    anomaly: false,
  },
  {
    pipeId: "BOU16-F2",
    venue: "Abbey Room",
    stopId: "st-bourdon16",
    pitch: "F2",
    measuredCents: -14,
    obsTemp: 18,
    obsHumidity: 62,
    reedStatus: "正常",
    note: "标记复检：低音管偏低",
    anomaly: true,
  },
];

/** 弱网环境下已登记、尚未回传的音管 */
const PENDING_SEEDS: PipeFormValues[] = [
  {
    pipeId: "MIX4-C5",
    venue: "St.Mary",
    stopId: "st-mixture4",
    pitch: "C5",
    measuredCents: 14,
    obsTemp: 26,
    obsHumidity: 60,
    reedStatus: "正常",
    note: "混合音栓偏高，观察中",
    anomaly: true,
  },
  {
    pipeId: "GED8-A3",
    venue: "ConcertHall A",
    stopId: "st-gedackt8",
    pitch: "A3",
    measuredCents: 2,
    obsTemp: 21,
    obsHumidity: 49,
    reedStatus: "正常",
    note: "",
    anomaly: false,
  },
];

export function makePipe(values: PipeFormValues, status: SyncStatus): PipeRecord {
  const fieldMeta = {} as Record<PipeField, FieldMeta>;
  for (const f of PIPE_FIELDS) {
    fieldMeta[f] = { version: 1, syncedValue: values[f] };
  }
  return {
    ...values,
    revision: 1,
    fieldMeta,
    syncStatus: status,
    updatedAt: Date.now(),
  };
}

export function seedPipes(): PipeRecord[] {
  return [
    ...SYNCED_SEEDS.map((v) => makePipe(v, "synced")),
    ...PENDING_SEEDS.map((v) => makePipe(v, "pending")),
  ];
}

/** 模拟总档初始内容：只包含已同步的三根音管 */
export function seedMasterPipes(): Record<string, MasterPipe> {
  const out: Record<string, MasterPipe> = {};
  for (const v of SYNCED_SEEDS) {
    const fields = {} as Record<PipeField, unknown>;
    const versions = {} as Record<PipeField, number>;
    for (const f of PIPE_FIELDS) {
      fields[f] = v[f];
      versions[f] = 1;
    }
    out[v.pipeId] = {
      pipeId: v.pipeId,
      fields,
      versions,
      appliedKeys: [`${v.pipeId}#r1`],
      updatedAt: Date.now(),
    };
  }
  return out;
}

export function seedEnvObs(): EnvObservation[] {
  const now = Date.now();
  return [
    { id: "env-3", venue: "Abbey Room", temp: 18, humidity: 62, at: now - 60 * 60 * 1000 },
    { id: "env-2", venue: "ConcertHall A", temp: 20, humidity: 50, at: now - 2 * 60 * 60 * 1000 },
    { id: "env-1", venue: "St.Mary", temp: 24, humidity: 58, at: now - 3 * 60 * 60 * 1000 },
  ];
}

export function seedReports(): MaintenanceReport[] {
  const stMary = SYNCED_SEEDS.concat(PENDING_SEEDS).filter((p) => p.venue === "St.Mary");
  const devs = stMary.map((p) =>
    Math.abs(compensateCents(p.measuredCents, p.obsTemp, DEFAULT_BASE_TEMP))
  );
  const now = Date.now();
  return [
    {
      id: `St.Mary-${new Date().getFullYear()}`,
      venue: "St.Mary",
      year: new Date().getFullYear(),
      status: "confirmed",
      baseTemp: DEFAULT_BASE_TEMP,
      generatedAt: now - 2 * 24 * 60 * 60 * 1000,
      confirmedAt: now - 24 * 60 * 60 * 1000,
      totalPipes: stMary.length,
      anomalies: stMary.filter((p) => p.anomaly).length,
      overLimit: devs.filter((d) => d > DEVIATION_LIMIT_CENTS).length,
      avgAbsDeviation: Math.round((devs.reduce((a, b) => a + b, 0) / devs.length) * 10) / 10,
    },
  ];
}
