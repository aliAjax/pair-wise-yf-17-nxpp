// 总档初始数据：一座教堂的音管台账 + 初始温湿度观测 + 一份已确认报告
import type {
  LocalState,
  MasterState,
  Observation,
  PipeRecord,
  ReedState,
  MaintenanceReport,
  StopRecord,
  StopKind,
} from "./types";

const DAY = 86400_000;
const HOUR = 3600_000;

function field<T>(value: T, opId: string, by: string, at: number) {
  return { value, updatedAt: at, updatedBy: by, opId };
}

const NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];

type StopSeed = { name: string; kind: StopKind; venue: string };

const STOP_SEEDS: StopSeed[] = [
  { name: "Principal 8'", kind: "主音栓", venue: "圣玛丽教堂" },
  { name: "Trumpet 8'", kind: "簧片音栓", venue: "圣玛丽教堂" },
  { name: "Bourdon 16'", kind: "低音管", venue: "圣玛丽教堂" },
];

// 初始实测音分偏差（含几处异常，供异常标记页展示）
const MEASURED: Record<string, number> = {
  "0-C4": 2.1,
  "0-D4": -3.4,
  "0-E4": 1.2,
  "0-F4": -6.8,
  "0-G4": 0.6,
  "0-A4": 4.5,
  "0-B4": -2.3,
  "0-C5": 1.8,
  "1-C4": -12.4,
  "1-D4": 3.2,
  "1-E4": 1.6,
  "1-F4": -2.8,
  "1-G4": 11.2,
  "1-A4": -1.4,
  "1-B4": 2.9,
  "1-C5": -3.6,
  "2-C4": -4.2,
  "2-D4": 2.6,
  "2-E4": -1.8,
  "2-F4": 13.5,
  "2-G4": -0.9,
  "2-A4": 3.8,
  "2-B4": -5.1,
  "2-C5": 2.2,
};

const REED: Record<string, ReedState> = {
  "1-C4": "needs_reed_work",
  "1-G4": "needs_tuning",
  "2-F4": "needs_tuning",
};

const MARKED: Record<string, boolean> = {
  "1-C4": true,
  "2-F4": true,
};

export function buildSeed(): { master: MasterState; local: LocalState } {
  const now = Date.now();
  const master: MasterState = {
    pipes: {},
    stops: {},
    observations: {},
    reports: {},
    baseTemp: 20,
    appliedOpIds: [],
    revision: 1,
  };

  const stops: StopRecord[] = STOP_SEEDS.map((s, i) => ({
    id: `stop-${i}`,
    name: s.name,
    kind: s.kind,
    venue: s.venue,
    pipeIds: NOTES.map((_, j) => `pipe-${i}-${j}`),
  }));

  const pipes: PipeRecord[] = [];
  stops.forEach((stop, si) => {
    NOTES.forEach((note, ni) => {
      const id = `pipe-${si}-${ni}`;
      const at = now - 5 * DAY - ni * HOUR;
      pipes.push({
        id,
        stopId: stop.id,
        label: note,
        pitch: note,
        measuredCents: field<number | null>(
          MEASURED[`${si}-${note}`] ?? 0,
          `seed-pipe-${id}-measuredCents`,
          "调音师乙",
          at
        ),
        reedState: field<ReedState>(
          REED[`${si}-${note}`] ?? "normal",
          `seed-pipe-${id}-reedState`,
          "调音师乙",
          at
        ),
        notes: field<string>(
          MARKED[`${si}-${note}`] ? "标记复检" : "正常",
          `seed-pipe-${id}-notes`,
          "调音师乙",
          at
        ),
        marked: field<boolean>(
          MARKED[`${si}-${note}`] ?? false,
          `seed-pipe-${id}-marked`,
          "调音师乙",
          at
        ),
        reducedCents: null,
        reducedStale: false,
        compVersion: 20,
      });
    });
  });

  stops.forEach((s) => (master.stops[s.id] = s));
  pipes.forEach((p) => (master.pipes[p.id] = p));

  const obs1: Observation = {
    id: "obs-1",
    venue: field("圣玛丽教堂", "seed-obs-1-venue", "调音师乙", now - 2 * DAY),
    temp: field(20, "seed-obs-1-temp", "调音师乙", now - 2 * DAY),
    humidity: field(50, "seed-obs-1-humidity", "调音师乙", now - 2 * DAY),
    recordedAt: field(now - 2 * DAY, "seed-obs-1-recordedAt", "调音师乙", now - 2 * DAY),
    recordedBy: field("调音师乙", "seed-obs-1-recordedBy", "调音师乙", now - 2 * DAY),
    note: field("进场校准时的初始观测", "seed-obs-1-note", "调音师乙", now - 2 * DAY),
  };
  const obs2: Observation = {
    id: "obs-2",
    venue: field("圣玛丽教堂", "seed-obs-2-venue", "调音师甲", now - 3 * HOUR),
    temp: field(22, "seed-obs-2-temp", "调音师甲", now - 3 * HOUR),
    humidity: field(45, "seed-obs-2-humidity", "调音师甲", now - 3 * HOUR),
    recordedAt: field(now - 3 * HOUR, "seed-obs-2-recordedAt", "调音师甲", now - 3 * HOUR),
    recordedBy: field("调音师甲", "seed-obs-2-recordedBy", "调音师甲", now - 3 * HOUR),
    note: field("午后复测，场馆升温", "seed-obs-2-note", "调音师甲", now - 3 * HOUR),
  };
  master.observations[obs1.id] = obs1;
  master.observations[obs2.id] = obs2;

  const report: MaintenanceReport = {
    id: "report-1",
    venue: field("圣玛丽教堂", "seed-report-1-venue", "调音师乙", now - 10 * DAY),
    title: field("圣玛丽教堂秋季调音维护", "seed-report-1-title", "调音师乙", now - 10 * DAY),
    date: field(now - 10 * DAY, "seed-report-1-date", "调音师乙", now - 10 * DAY),
    tuners: field(["调音师乙"], "seed-report-1-tuners", "调音师乙", now - 10 * DAY),
    pipeIds: field(
      pipes.map((p) => p.id),
      "seed-report-1-pipeIds",
      "调音师乙",
      now - 10 * DAY
    ),
    status: field<"confirmed">(
      "confirmed",
      "seed-report-1-status",
      "调音师乙",
      now - 9 * DAY
    ),
    summary: field(
      "全部音管完成初调，待春季复测。",
      "seed-report-1-summary",
      "调音师乙",
      now - 10 * DAY
    ),
    baseTempAtConfirm: 20,
  };
  master.reports[report.id] = report;

  // 所有种子 opId 均已在总档生效
  const applied: string[] = [];
  const collect = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (typeof o.opId === "string") applied.push(o.opId);
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") collect(v);
    }
  };
  collect(master);
  master.appliedOpIds = applied;

  // 本地初始 = 总档的完整副本（全部字段标记为已同步）
  const local: LocalState = {
    identity: "调音师甲",
    pipes: structuredClone(master.pipes),
    stops: structuredClone(master.stops),
    observations: structuredClone(master.observations),
    reports: structuredClone(master.reports),
    baseTemp: master.baseTemp,
    appliedOpIds: [...master.appliedOpIds],
    syncedOpIds: {},
    outbox: [],
    conflicts: [],
    pipeSync: {},
    lastSyncAt: now,
    compVersion: master.baseTemp,
    notice: null,
    logs: [
      {
        id: "seed-log",
        at: now,
        kind: "info",
        message: "总档已加载：3 个音栓、24 根音管、2 条温湿度观测、1 份已确认报告。",
      },
    ],
  };

  // 每个字段都标记为已同步
  for (const [pid, p] of Object.entries(local.pipes)) {
    local.pipeSync[pid] = "synced";
    for (const f of ["measuredCents", "reedState", "notes", "marked"]) {
      local.syncedOpIds[`pipe:${pid}:${f}`] = (p as unknown as Record<string, { opId: string }>)[f].opId;
    }
  }
  for (const [sid, s] of Object.entries(local.stops)) {
    for (const f of ["name", "kind", "venue"]) {
      local.syncedOpIds[`stop:${sid}:${f}`] = (s as unknown as Record<string, { opId: string }>)[f].opId;
    }
  }
  for (const [oid, o] of Object.entries(local.observations)) {
    for (const f of ["venue", "temp", "humidity", "recordedAt", "recordedBy", "note"]) {
      local.syncedOpIds[`observation:${oid}:${f}`] = (o as unknown as Record<string, { opId: string }>)[f].opId;
    }
  }
  for (const [rid, r] of Object.entries(local.reports)) {
    for (const f of ["venue", "title", "date", "tuners", "pipeIds", "status", "summary"]) {
      local.syncedOpIds[`report:${rid}:${f}`] = (r as unknown as Record<string, { opId: string }>)[f].opId;
    }
  }
  local.syncedOpIds["meta:baseTemp:baseTemp"] = "seed-meta-baseTemp";

  return { master, local };
}
