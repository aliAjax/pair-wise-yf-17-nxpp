// 工作台状态：离线登记、弱网回传、逐字段合并、冲突确认、基准温度作废重算

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  DEFAULT_BASE_TEMP,
  DEVIATION_LIMIT_CENTS,
  compensateCents,
} from "../domain/compensation";
import {
  applyToMaster,
  masterHasPipe,
  masterResolveField,
  peerEditOnMaster,
  type MergeOutcome,
} from "../domain/master";
import { STOPS, makePipe, seedEnvObs, seedPipes, seedReports } from "../domain/seed";
import {
  FIELD_LABELS,
  PIPE_FIELDS,
  type ConflictItem,
  type EnvObservation,
  type MaintenanceReport,
  type PipeField,
  type PipeFormValues,
  type PipeRecord,
  type ReedStatus,
  type StopDef,
  type SyncStatus,
} from "../domain/types";

const LOCAL_KEY = "organ-workbench-v1";

export interface WorkbenchState {
  pipes: PipeRecord[];
  stops: StopDef[];
  envObs: EnvObservation[];
  reports: MaintenanceReport[];
  conflicts: ConflictItem[];
  baseTemp: number;
  online: boolean;
  weakNet: boolean;
  syncing: boolean;
  syncLog: string[];
  lastRecalcAt: number | null;
}

type Action =
  | { type: "upsert-pipe"; values: PipeFormValues }
  | { type: "toggle-anomaly"; pipeId: string }
  | { type: "set-sync-status"; pipeId: string; status: SyncStatus }
  | { type: "merge-result"; pipeId: string; outcome: MergeOutcome }
  | { type: "resolve-conflict"; pipeId: string; field: PipeField; keep: "local" | "master" }
  | { type: "set-online"; online: boolean }
  | { type: "set-weaknet"; weakNet: boolean }
  | { type: "set-syncing"; syncing: boolean }
  | { type: "set-base-temp"; temp: number }
  | { type: "add-env-obs"; obs: EnvObservation }
  | { type: "generate-report"; venue: string; year: number }
  | { type: "confirm-report"; id: string }
  | { type: "log"; text: string };

const timeStamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

const pushLog = (state: WorkbenchState, text: string): string[] =>
  [...state.syncLog, `[${timeStamp()}] ${text}`].slice(-60);

function loadInitial(): WorkbenchState {
  const base: WorkbenchState = {
    pipes: seedPipes(),
    stops: STOPS,
    envObs: seedEnvObs(),
    reports: seedReports(),
    conflicts: [],
    baseTemp: DEFAULT_BASE_TEMP,
    online: true,
    weakNet: true,
    syncing: false,
    syncLog: [
      `[${timeStamp()}] 系统就绪：弱网模拟已开启，断网可照常登记，恢复后自动补传未同步音管`,
    ],
    lastRecalcAt: null,
  };
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<WorkbenchState>;
      return {
        ...base,
        pipes: saved.pipes ?? base.pipes,
        envObs: saved.envObs ?? base.envObs,
        reports: saved.reports ?? base.reports,
        conflicts: saved.conflicts ?? base.conflicts,
        baseTemp: saved.baseTemp ?? base.baseTemp,
      };
    }
  } catch {
    // 本地存档不可用时使用种子数据
  }
  return base;
}

function reducer(state: WorkbenchState, action: Action): WorkbenchState {
  switch (action.type) {
    case "upsert-pipe": {
      const v = action.values;
      const existing = state.pipes.find((p) => p.pipeId === v.pipeId);
      if (!existing) {
        const rec = makePipe(v, "pending");
        return {
          ...state,
          pipes: [...state.pipes, rec],
          syncLog: pushLog(state, `已登记 ${v.pipeId}（本地暂存，待回传总档）`),
        };
      }
      const fieldMeta = { ...existing.fieldMeta };
      let changed = false;
      for (const f of PIPE_FIELDS) {
        if (!Object.is(existing[f], v[f])) {
          fieldMeta[f] = { ...fieldMeta[f], version: fieldMeta[f].version + 1 };
          changed = true;
        }
      }
      if (!changed) {
        return { ...state, syncLog: pushLog(state, `${v.pipeId} 内容未变化`) };
      }
      const updated: PipeRecord = {
        ...existing,
        ...v,
        fieldMeta,
        revision: existing.revision + 1,
        syncStatus: existing.syncStatus === "conflict" ? "conflict" : "pending",
        updatedAt: Date.now(),
      };
      return {
        ...state,
        pipes: state.pipes.map((p) => (p.pipeId === v.pipeId ? updated : p)),
        syncLog: pushLog(state, `已更新 ${v.pipeId}，待回传合并`),
      };
    }

    case "toggle-anomaly": {
      const target = state.pipes.find((p) => p.pipeId === action.pipeId);
      if (!target) return state;
      const next: PipeRecord = {
        ...target,
        anomaly: !target.anomaly,
        fieldMeta: {
          ...target.fieldMeta,
          anomaly: {
            ...target.fieldMeta.anomaly,
            version: target.fieldMeta.anomaly.version + 1,
          },
        },
        revision: target.revision + 1,
        syncStatus: target.syncStatus === "conflict" ? "conflict" : "pending",
        updatedAt: Date.now(),
      };
      return {
        ...state,
        pipes: state.pipes.map((p) => (p.pipeId === action.pipeId ? next : p)),
        syncLog: pushLog(
          state,
          `${action.pipeId} ${next.anomaly ? "已标记为异常音管" : "已解除异常标记"}`
        ),
      };
    }

    case "set-sync-status":
      return {
        ...state,
        pipes: state.pipes.map((p) =>
          p.pipeId === action.pipeId ? { ...p, syncStatus: action.status } : p
        ),
      };

    case "merge-result": {
      const { pipeId, outcome } = action;
      const conflictFields = new Set(outcome.conflicts.map((c) => c.field));
      const pipes = state.pipes.map((p) => {
        if (p.pipeId !== pipeId) return p;
        const next: PipeRecord = { ...p, fieldMeta: { ...p.fieldMeta } };
        for (const f of PIPE_FIELDS) {
          if (conflictFields.has(f)) continue; // 冲突字段保持两版，等确认
          if (Object.prototype.hasOwnProperty.call(outcome.adopt, f)) {
            (next as unknown as Record<string, unknown>)[f] = outcome.adopt[f];
          }
          next.fieldMeta[f] = {
            version: Math.max(next.fieldMeta[f].version, outcome.master.versions[f]),
            syncedValue: outcome.master.fields[f],
          };
        }
        next.syncStatus = outcome.conflicts.length > 0 ? "conflict" : "synced";
        return next;
      });
      const conflicts = [
        ...state.conflicts.filter((c) => c.pipeId !== pipeId),
        ...outcome.conflicts,
      ];
      return { ...state, pipes, conflicts };
    }

    case "resolve-conflict": {
      const c = state.conflicts.find(
        (x) => x.pipeId === action.pipeId && x.field === action.field
      );
      if (!c) return state;
      const conflicts = state.conflicts.filter(
        (x) => !(x.pipeId === action.pipeId && x.field === action.field)
      );
      const pipes = state.pipes.map((p) => {
        if (p.pipeId !== action.pipeId) return p;
        const next: PipeRecord = { ...p, fieldMeta: { ...p.fieldMeta } };
        if (action.keep === "master") {
          (next as unknown as Record<string, unknown>)[action.field] = c.masterValue;
          next.fieldMeta[action.field] = {
            ...next.fieldMeta[action.field],
            syncedValue: c.masterValue,
          };
        } else {
          next.fieldMeta[action.field] = {
            ...next.fieldMeta[action.field],
            syncedValue: c.localValue,
          };
        }
        const stillConflict = conflicts.some((x) => x.pipeId === action.pipeId);
        next.syncStatus = stillConflict ? "conflict" : "synced";
        return next;
      });
      return {
        ...state,
        pipes,
        conflicts,
        syncLog: pushLog(
          state,
          `冲突已确认：${action.pipeId}「${FIELD_LABELS[action.field]}」采用${
            action.keep === "local" ? "本地" : "总档"
          }版本`
        ),
      };
    }

    case "set-online":
      if (state.online === action.online) return state;
      return {
        ...state,
        online: action.online,
        syncLog: pushLog(
          state,
          action.online
            ? "网络已恢复，准备补传未同步音管"
            : "已断网：登记、观测照常进行，记录存入本地队列"
        ),
      };

    case "set-weaknet":
      return {
        ...state,
        weakNet: action.weakNet,
        syncLog: pushLog(state, action.weakNet ? "已开启弱网模拟" : "已关闭弱网模拟"),
      };

    case "set-syncing":
      return { ...state, syncing: action.syncing };

    case "set-base-temp": {
      const t = action.temp;
      if (!Number.isFinite(t) || t === state.baseTemp) return state;
      const demoted = state.reports.filter((r) => r.status === "confirmed").length;
      const reports = state.reports.map((r) =>
        r.status === "confirmed"
          ? {
              ...r,
              status: "pending_review" as const,
              note: `基准温度 ${state.baseTemp}°C → ${t}°C，音分偏差已作废重算，报告退回待复核`,
            }
          : r
      );
      return {
        ...state,
        baseTemp: t,
        reports,
        lastRecalcAt: Date.now(),
        syncLog: pushLog(
          state,
          `基准温度 ${state.baseTemp}°C → ${t}°C：全部音分偏差按统一口径作废重算${
            demoted ? `，${demoted} 份已确认报告退回待复核` : ""
          }`
        ),
      };
    }

    case "add-env-obs":
      return {
        ...state,
        envObs: [action.obs, ...state.envObs],
        syncLog: pushLog(
          state,
          `已登记温湿度观测：${action.obs.venue} ${action.obs.temp}°C / ${action.obs.humidity}%`
        ),
      };

    case "generate-report": {
      const venuePipes = state.pipes.filter((p) => p.venue === action.venue);
      if (!venuePipes.length) {
        return {
          ...state,
          syncLog: pushLog(state, `${action.venue} 暂无音管记录，无法生成报告`),
        };
      }
      const devs = venuePipes.map((p) =>
        Math.abs(compensateCents(p.measuredCents, p.obsTemp, state.baseTemp))
      );
      const id = `${action.venue}-${action.year}`;
      const existing = state.reports.find((r) => r.id === id);
      const report: MaintenanceReport = {
        id,
        venue: action.venue,
        year: action.year,
        status: existing?.status === "confirmed" ? "pending_review" : "draft",
        baseTemp: state.baseTemp,
        generatedAt: Date.now(),
        confirmedAt: existing?.confirmedAt,
        totalPipes: venuePipes.length,
        anomalies: venuePipes.filter((p) => p.anomaly).length,
        overLimit: devs.filter((d) => d > DEVIATION_LIMIT_CENTS).length,
        avgAbsDeviation: Math.round((devs.reduce((a, b) => a + b, 0) / devs.length) * 10) / 10,
        note:
          existing?.status === "confirmed"
            ? "报告数据已刷新，需复核后重新确认"
            : existing?.note,
      };
      return {
        ...state,
        reports: existing
          ? state.reports.map((r) => (r.id === id ? report : r))
          : [...state.reports, report],
        syncLog: pushLog(
          state,
          `已生成 ${action.venue} ${action.year} 年度维护报告（基准温度 ${state.baseTemp}°C）`
        ),
      };
    }

    case "confirm-report":
      return {
        ...state,
        reports: state.reports.map((r) =>
          r.id === action.id
            ? { ...r, status: "confirmed", confirmedAt: Date.now(), note: undefined }
            : r
        ),
        syncLog: pushLog(state, `报告 ${action.id} 已确认`),
      };

    case "log":
      return { ...state, syncLog: pushLog(state, action.text) };

    default:
      return state;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 另一调音师可能改动的字段 */
const PEER_FIELDS: PipeField[] = [
  "measuredCents",
  "obsTemp",
  "obsHumidity",
  "reedStatus",
  "note",
  "anomaly",
];

function peerValue(field: PipeField, rec: PipeRecord): unknown {
  switch (field) {
    case "measuredCents":
      return Math.round((rec.measuredCents + (Math.random() * 6 - 3)) * 2) / 2;
    case "obsTemp":
      return Math.round((rec.obsTemp + (Math.random() < 0.5 ? -1 : 1)) * 2) / 2;
    case "obsHumidity":
      return Math.min(90, Math.max(30, rec.obsHumidity + (Math.random() < 0.5 ? -3 : 3)));
    case "reedStatus": {
      const opts: ReedStatus[] = ["正常", "簧片需微调", "标记复检", "需更换"];
      return opts[(opts.indexOf(rec.reedStatus) + 1) % opts.length];
    }
    case "note":
      return rec.note ? `${rec.note}（总档复核）` : "另一调音师复核：已现场复测";
    case "anomaly":
      return !rec.anomaly;
    default:
      return rec[field];
  }
}

export function useWorkbench() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);
  const stateRef = useRef(state);
  const syncingRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 本地持久化：断网重开页面后登记内容仍在
  useEffect(() => {
    try {
      localStorage.setItem(
        LOCAL_KEY,
        JSON.stringify({
          pipes: state.pipes,
          envObs: state.envObs,
          reports: state.reports,
          conflicts: state.conflicts,
          baseTemp: state.baseTemp,
        })
      );
    } catch {
      // 存储不可用时保持内存态
    }
  }, [state.pipes, state.envObs, state.reports, state.conflicts, state.baseTemp]);

  /**
   * 回传总档：只处理待回传 / 失败的音管（已同步的跳过）。
   * 某根失败即中止本轮，已完成的保留，恢复后只补未同步的部分。
   */
  const syncRun = useCallback(async () => {
    if (syncingRef.current) return;
    const s0 = stateRef.current;
    if (!s0.online) {
      dispatch({ type: "log", text: "当前离线：登记已存入本地，待网络恢复后回传" });
      return;
    }
    const targets = s0.pipes.filter(
      (p) => p.syncStatus === "pending" || p.syncStatus === "failed"
    );
    if (!targets.length) {
      dispatch({ type: "log", text: "没有待回传的音管" });
      return;
    }
    syncingRef.current = true;
    dispatch({ type: "set-syncing", syncing: true });
    dispatch({ type: "log", text: `开始回传 ${targets.length} 根音管…` });
    let done = 0;
    for (const p of targets) {
      if (!stateRef.current.online) {
        dispatch({
          type: "log",
          text: `网络中断：已保住 ${done} 根，其余待网络恢复后补传`,
        });
        break;
      }
      dispatch({ type: "set-sync-status", pipeId: p.pipeId, status: "syncing" });
      await sleep(500);
      if (!stateRef.current.online) {
        dispatch({ type: "set-sync-status", pipeId: p.pipeId, status: "failed" });
        dispatch({
          type: "log",
          text: `网络中断：${p.pipeId} 未完成，已保住 ${done} 根，恢复后只补未同步部分`,
        });
        break;
      }
      const failed = stateRef.current.weakNet && Math.random() < 0.3;
      if (failed) {
        // 弱网失败：一半概率总档其实已收到但回执丢失，补传时靠幂等键去重
        if (Math.random() < 0.5) {
          applyToMaster(p);
          dispatch({
            type: "log",
            text: `⚠ ${p.pipeId} 回执丢失（总档可能已收到），标记失败待补传`,
          });
        } else {
          dispatch({
            type: "log",
            text: `⚠ ${p.pipeId} 上传失败，已保住前面 ${done} 根，恢复后只补未同步部分`,
          });
        }
        dispatch({ type: "set-sync-status", pipeId: p.pipeId, status: "failed" });
        break;
      }
      const outcome = applyToMaster(p);
      dispatch({ type: "merge-result", pipeId: p.pipeId, outcome });
      done += 1;
      if (outcome.duplicate) {
        dispatch({
          type: "log",
          text: `↺ ${p.pipeId} 重复回传，总档已忽略，不生成第二份记录`,
        });
      } else if (outcome.conflicts.length) {
        dispatch({
          type: "log",
          text: `⚡ ${p.pipeId} 有 ${outcome.conflicts.length} 个字段两边都改过，已留两版待确认`,
        });
      } else {
        dispatch({
          type: "log",
          text: `✓ ${p.pipeId} 已按音管编号逐字段合并回总档`,
        });
      }
    }
    syncingRef.current = false;
    dispatch({ type: "set-syncing", syncing: false });
    dispatch({ type: "log", text: `本轮回传结束：完成 ${done}/${targets.length}` });
  }, []);

  // 网络恢复后自动补传未同步音管
  const prevOnline = useRef(state.online);
  useEffect(() => {
    if (state.online && !prevOnline.current) {
      const hasPending = stateRef.current.pipes.some(
        (p) => p.syncStatus === "pending" || p.syncStatus === "failed"
      );
      if (hasPending) {
        dispatch({ type: "log", text: "检测到未同步音管，自动补传" });
        void syncRun();
      }
    }
    prevOnline.current = state.online;
  }, [state.online, syncRun]);

  /** 模拟另一位调音师回传总档（优先挑本地也改过的字段，便于演示冲突） */
  const simulatePeer = useCallback(() => {
    const s = stateRef.current;
    const inMaster = s.pipes.filter((p) => masterHasPipe(p.pipeId));
    if (!inMaster.length) {
      dispatch({ type: "log", text: "总档还没有记录，先回传一批再模拟" });
      return;
    }
    const dirty = inMaster.filter((p) =>
      PIPE_FIELDS.some((f) => !Object.is(p[f], p.fieldMeta[f].syncedValue))
    );
    const pool = dirty.length && Math.random() < 0.75 ? dirty : inMaster;
    const target = pool[Math.floor(Math.random() * pool.length)];
    const changed = PIPE_FIELDS.filter(
      (f) => !Object.is(target[f], target.fieldMeta[f].syncedValue) && PEER_FIELDS.includes(f)
    );
    const choices = changed.length && Math.random() < 0.75 ? changed : PEER_FIELDS;
    const field = choices[Math.floor(Math.random() * choices.length)];
    if (peerEditOnMaster(target.pipeId, field, peerValue(field, target))) {
      dispatch({
        type: "log",
        text: `另一位调音师回传了 ${target.pipeId} 的「${FIELD_LABELS[field]}」，下次同步时合并`,
      });
    }
  }, []);

  const resolveConflict = useCallback(
    (pipeId: string, field: PipeField, keep: "local" | "master") => {
      const c = stateRef.current.conflicts.find(
        (x) => x.pipeId === pipeId && x.field === field
      );
      if (!c) return;
      if (keep === "local") {
        masterResolveField(pipeId, field, c.localValue);
      }
      dispatch({ type: "resolve-conflict", pipeId, field, keep });
    },
    []
  );

  return {
    state,
    syncRun,
    simulatePeer,
    resolveConflict,
    upsertPipe: (values: PipeFormValues) => dispatch({ type: "upsert-pipe", values }),
    toggleAnomaly: (pipeId: string) => dispatch({ type: "toggle-anomaly", pipeId }),
    setOnline: (online: boolean) => dispatch({ type: "set-online", online }),
    setWeakNet: (weakNet: boolean) => dispatch({ type: "set-weaknet", weakNet }),
    changeBaseTemp: (temp: number) => dispatch({ type: "set-base-temp", temp }),
    addEnvObs: (venue: string, temp: number, humidity: number) =>
      dispatch({
        type: "add-env-obs",
        obs: {
          id: `env-${Date.now()}`,
          venue,
          temp,
          humidity,
          at: Date.now(),
        },
      }),
    generateReport: (venue: string) =>
      dispatch({ type: "generate-report", venue, year: new Date().getFullYear() }),
    confirmReport: (id: string) => dispatch({ type: "confirm-report", id }),
  };
}
