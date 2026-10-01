// 模拟总档（服务端档案）：按音管编号 + 逐字段三方合并，幂等键防止重复记录。
// 存放在独立的 localStorage 键下，本地登记绝不会直接写它，只能经由同步引擎合并。

import { seedMasterPipes } from "./seed";
import {
  PIPE_FIELDS,
  type ConflictItem,
  type MasterPipe,
  type PipeField,
  type PipeRecord,
} from "./types";

const MASTER_KEY = "organ-master-archive-v1";

interface MasterDB {
  pipes: Record<string, MasterPipe>;
}

let cache: MasterDB | null = null;

function load(): MasterDB {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(MASTER_KEY);
    if (raw) {
      cache = JSON.parse(raw) as MasterDB;
      return cache;
    }
  } catch {
    // 忽略损坏的存档，重新播种
  }
  cache = { pipes: seedMasterPipes() };
  persist();
  return cache;
}

function persist(): void {
  try {
    localStorage.setItem(MASTER_KEY, JSON.stringify(cache));
  } catch {
    // 存储不可用时保持内存态
  }
}

export interface MergeOutcome {
  /** 总档更新、本地需要采纳的字段值 */
  adopt: Partial<Record<PipeField, unknown>>;
  /** 两边都改过且不一致的字段：留两版待确认 */
  conflicts: ConflictItem[];
  /** 幂等键命中：重复回传，未生成第二份记录 */
  duplicate: boolean;
  master: MasterPipe;
}

export function idempotencyKey(rec: PipeRecord): string {
  return `${rec.pipeId}#r${rec.revision}`;
}

/**
 * 将一根本地音管合并回总档。
 * 逐字段三方合并：以 fieldMeta.syncedValue 为基准，
 * 仅本地改过 → 总档采用本地；仅总档改过 → 本地采纳总档；两边都改过且不一致 → 冲突留两版。
 */
export function applyToMaster(rec: PipeRecord): MergeOutcome {
  const db = load();
  const key = idempotencyKey(rec);
  const conflicts: ConflictItem[] = [];
  const adopt: Partial<Record<PipeField, unknown>> = {};
  let mp = db.pipes[rec.pipeId];

  if (mp && mp.appliedKeys.includes(key)) {
    // 重复回传（例如上次回执丢失后的补传）：直接确认，不生成第二份记录
    return { adopt, conflicts, duplicate: true, master: mp };
  }

  if (!mp) {
    const fields = {} as Record<PipeField, unknown>;
    const versions = {} as Record<PipeField, number>;
    for (const f of PIPE_FIELDS) {
      fields[f] = rec[f];
      versions[f] = rec.fieldMeta[f].version;
    }
    mp = { pipeId: rec.pipeId, fields, versions, appliedKeys: [], updatedAt: Date.now() };
  } else {
    for (const f of PIPE_FIELDS) {
      const base = rec.fieldMeta[f].syncedValue;
      const localVal = rec[f];
      const masterVal = mp.fields[f];
      const localChanged = !Object.is(localVal, base);
      const masterChanged = !Object.is(masterVal, base);
      if (localChanged && masterChanged && !Object.is(localVal, masterVal)) {
        conflicts.push({
          pipeId: rec.pipeId,
          field: f,
          localValue: localVal,
          masterValue: masterVal,
          baseValue: base,
        });
      } else if (localChanged) {
        mp.fields[f] = localVal;
        mp.versions[f] = rec.fieldMeta[f].version;
      } else if (masterChanged) {
        adopt[f] = masterVal;
      }
    }
  }

  mp.appliedKeys.push(key);
  mp.updatedAt = Date.now();
  db.pipes[rec.pipeId] = mp;
  persist();
  return { adopt, conflicts, duplicate: false, master: mp };
}

export function masterHasPipe(pipeId: string): boolean {
  return Boolean(load().pipes[pipeId]);
}

/** 冲突确认「采用本地」后，把本地值写入总档 */
export function masterResolveField(pipeId: string, field: PipeField, value: unknown): void {
  const db = load();
  const mp = db.pipes[pipeId];
  if (!mp) return;
  mp.fields[field] = value;
  mp.versions[field] += 1;
  mp.updatedAt = Date.now();
  persist();
}

/** 模拟另一位调音师回传：直接改总档，下次同步时与本地合并 */
export function peerEditOnMaster(pipeId: string, field: PipeField, value: unknown): boolean {
  const db = load();
  const mp = db.pipes[pipeId];
  if (!mp) return false;
  mp.fields[field] = value;
  mp.versions[field] += 1;
  mp.updatedAt = Date.now();
  persist();
  return true;
}
