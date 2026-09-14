// ShiftFlow PWA — Import/Export
// import-export/json/jsonBackup.ts
//
// JSON is the COMPLETE LOCAL BACKUP format. It contains every persistent store
// required to reconstruct local application state — and nothing device-specific
// (no service-worker state, no browser cache, no UI/navigation state).
//
// Stores included (mirror the iOS persistent model + PWA-persisted reminders):
//   workDays, shiftDefinitions, scheduleRules, taskDefinitions,
//   workDayTasks, workDayEvents, reminders

import type { ShiftFlowDB } from "@/storage/db/db";
import type {
  ReminderConfiguration,
  ScheduleRule,
  ShiftDefinition,
  TaskDefinition,
  WorkDay,
  WorkDayEvent,
  WorkDayTask,
} from "@/domain/models/models";

export const BACKUP_FORMAT = "shiftflow-backup";
export const BACKUP_VERSION = 1;

export interface ShiftFlowBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string; // ISO
  data: {
    workDays: WorkDay[];
    shiftDefinitions: ShiftDefinition[];
    scheduleRules: ScheduleRule[];
    taskDefinitions: TaskDefinition[];
    workDayTasks: WorkDayTask[];
    workDayEvents: WorkDayEvent[];
    reminders: ReminderConfiguration[];
  };
}

/** Builds a complete backup object from the database. Deterministic ordering. */
export async function buildBackup(db: ShiftFlowDB): Promise<ShiftFlowBackup> {
  const [
    workDays,
    shiftDefinitions,
    scheduleRules,
    taskDefinitions,
    workDayTasks,
    workDayEvents,
    reminders,
  ] = await Promise.all([
    db.workDays.toArray(),
    db.shiftDefinitions.toArray(),
    db.scheduleRules.toArray(),
    db.taskDefinitions.toArray(),
    db.workDayTasks.toArray(),
    db.workDayEvents.toArray(),
    db.reminders.toArray(),
  ]);

  const byId = <T extends { id: string }>(arr: T[]) =>
    [...arr].sort((a, b) => a.id.localeCompare(b.id));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      workDays: [...workDays].sort((a, b) => a.date.localeCompare(b.date)),
      shiftDefinitions: byId(shiftDefinitions),
      scheduleRules: byId(scheduleRules),
      taskDefinitions: byId(taskDefinitions),
      workDayTasks: byId(workDayTasks),
      workDayEvents: byId(workDayEvents),
      reminders: byId(reminders),
    },
  };
}

/** Serializes a backup to pretty JSON text. */
export async function exportBackupJson(db: ShiftFlowDB): Promise<string> {
  return JSON.stringify(await buildBackup(db), null, 2);
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupParseError";
  }
}

/** Parses and validates a backup JSON string. Throws BackupParseError. */
export function parseBackup(content: string): ShiftFlowBackup {
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    throw new BackupParseError("File JSON không hợp lệ");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new BackupParseError("Nội dung backup không hợp lệ");
  }
  const b = obj as Partial<ShiftFlowBackup>;
  if (b.format !== BACKUP_FORMAT) {
    throw new BackupParseError("Đây không phải file backup ShiftFlow");
  }
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) {
    throw new BackupParseError(`Phiên bản backup không hỗ trợ: ${b.version}`);
  }
  if (!b.data || typeof b.data !== "object") {
    throw new BackupParseError("Backup thiếu dữ liệu");
  }
  const d = b.data as ShiftFlowBackup["data"];
  const arrays: [string, unknown][] = [
    ["workDays", d.workDays],
    ["shiftDefinitions", d.shiftDefinitions],
    ["scheduleRules", d.scheduleRules],
    ["taskDefinitions", d.taskDefinitions],
    ["workDayTasks", d.workDayTasks],
    ["workDayEvents", d.workDayEvents],
    ["reminders", d.reminders],
  ];
  for (const [key, val] of arrays) {
    if (val !== undefined && !Array.isArray(val)) {
      throw new BackupParseError(`Trường '${key}' không hợp lệ`);
    }
  }
  // Normalize possibly-missing arrays.
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    exportedAt: b.exportedAt ?? new Date().toISOString(),
    data: {
      workDays: d.workDays ?? [],
      shiftDefinitions: d.shiftDefinitions ?? [],
      scheduleRules: d.scheduleRules ?? [],
      taskDefinitions: d.taskDefinitions ?? [],
      workDayTasks: d.workDayTasks ?? [],
      workDayEvents: d.workDayEvents ?? [],
      reminders: d.reminders ?? [],
    },
  };
}

export type BackupImportMode = "replace" | "merge";

/** Permanently clears every IndexedDB store used by ShiftFlow. */
export async function clearAllData(db: ShiftFlowDB): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.workDays,
      db.shiftDefinitions,
      db.scheduleRules,
      db.taskDefinitions,
      db.workDayTasks,
      db.workDayEvents,
      db.reminders,
    ],
    async () => {
      await Promise.all([
        db.workDays.clear(),
        db.shiftDefinitions.clear(),
        db.scheduleRules.clear(),
        db.taskDefinitions.clear(),
        db.workDayTasks.clear(),
        db.workDayEvents.clear(),
        db.reminders.clear(),
      ]);
    },
  );
}

export interface BackupImportSummary {
  workDays: number;
  shiftDefinitions: number;
  scheduleRules: number;
  taskDefinitions: number;
  workDayTasks: number;
  workDayEvents: number;
  reminders: number;
  mode: BackupImportMode;
}

/**
 * Applies a backup to the database.
 * - "replace": clears all stores, then writes the backup.
 * - "merge": upserts by id (backup wins on id collision). WorkDay date
 *   collisions with different ids are resolved by keeping the backup record
 *   and removing local duplicates for that date (last-writer = backup).
 */
export async function applyBackup(
  db: ShiftFlowDB,
  backup: ShiftFlowBackup,
  mode: BackupImportMode,
): Promise<BackupImportSummary> {
  const d = backup.data;

  // Dexie's spread-table transaction overloads cap out (mode + up to 5 tables
  // + callback). With 6 stores we pass the tables as an ARRAY, which is a
  // supported Dexie signature: transaction(mode, Table[], scope). This keeps a
  // single atomic transaction across all six stores — Replace/Merge behavior
  // and rollback-on-error are unchanged.
  await db.transaction(
    "rw",
    [
      db.workDays,
      db.shiftDefinitions,
      db.scheduleRules,
      db.taskDefinitions,
      db.workDayTasks,
      db.workDayEvents,
      db.reminders,
    ],
    async () => {
      if (mode === "replace") {
        await Promise.all([
          db.workDays.clear(),
          db.shiftDefinitions.clear(),
          db.scheduleRules.clear(),
          db.taskDefinitions.clear(),
          db.workDayTasks.clear(),
          db.workDayEvents.clear(),
          db.reminders.clear(),
        ]);
      } else {
        // Merge: for WorkDay date collisions with a different id, remove the
        // local record so the unique date index accepts the backup record.
        for (const w of d.workDays) {
          const localSameDate = await db.workDays.where("date").equals(w.date).first();
          if (localSameDate && localSameDate.id !== w.id) {
            await db.workDays.delete(localSameDate.id);
          }
        }
      }

      await db.shiftDefinitions.bulkPut(d.shiftDefinitions);
      await db.scheduleRules.bulkPut(d.scheduleRules);
      await db.taskDefinitions.bulkPut(d.taskDefinitions);
      await db.workDays.bulkPut(d.workDays);
      await db.workDayTasks.bulkPut(d.workDayTasks);
      await db.workDayEvents.bulkPut(d.workDayEvents);
      await db.reminders.bulkPut(d.reminders);
    },
  );

  return {
    workDays: d.workDays.length,
    shiftDefinitions: d.shiftDefinitions.length,
    scheduleRules: d.scheduleRules.length,
    taskDefinitions: d.taskDefinitions.length,
    workDayTasks: d.workDayTasks.length,
    workDayEvents: d.workDayEvents.length,
    reminders: d.reminders.length,
    mode,
  };
}
