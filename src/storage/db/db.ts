// ShiftFlow PWA — Storage Layer
// storage/db/db.ts
//
// Dexie schema. IndexedDB is the source of truth (local-first, offline).
// Object stores mirror the iOS SwiftData persistent models:
//   WorkDayModel, ShiftDefinitionModel, ScheduleRuleModel,
//   TaskDefinitionModel, WorkDayTaskModel
// plus ReminderConfiguration (persisted preference in the PWA).
//
// "One WorkDay per date" is enforced at the service layer (as on iOS), backed
// here by a unique index on WorkDay.date.

import Dexie, { type Table } from "dexie";
import type {
  ReminderConfiguration,
  ScheduleRule,
  ShiftDefinition,
  TaskDefinition,
  WorkDay,
  WorkDayEvent,
  WorkDayTask,
} from "@/domain/models/models";
import type { SyncChange, SyncMetaRecord } from "@/sync/syncTypes";
import { newId } from "@/services/id";

export class ShiftFlowDB extends Dexie {
  workDays!: Table<WorkDay, string>;
  shiftDefinitions!: Table<ShiftDefinition, string>;
  scheduleRules!: Table<ScheduleRule, string>;
  taskDefinitions!: Table<TaskDefinition, string>;
  workDayTasks!: Table<WorkDayTask, string>;
  workDayEvents!: Table<WorkDayEvent, string>;
  reminders!: Table<ReminderConfiguration, string>;
  /** Cloud-sync stores (added in v5). */
  syncQueue!: Table<SyncChange, string>;
  syncMeta!: Table<SyncMetaRecord, string>;

  constructor(name = "shiftflow") {
    super(name);
    // v1: original stores.
    this.version(1).stores({
      // &date -> unique index (one WorkDay per calendar date).
      workDays: "id, &date, shiftID, modifiedAt",
      shiftDefinitions: "id, code, isActive",
      scheduleRules: "id, shiftID, priority, isActive",
      taskDefinitions: "id, code, isActive",
      workDayTasks: "id, workDayID, taskDefinitionID",
      reminders: "id, workDayID",
    });

    // v2: adds task-assignment visibility. Index shape is unchanged (isVisible
    // is not indexed), but we bump the version to run a safe upgrade that
    // backfills existing WorkDayTask records with isVisible = true. Existing
    // user data is preserved — no store is cleared or recreated.
    this.version(2)
      .stores({
        workDays: "id, &date, shiftID, modifiedAt",
        shiftDefinitions: "id, code, isActive",
        scheduleRules: "id, shiftID, priority, isActive",
        taskDefinitions: "id, code, isActive",
        workDayTasks: "id, workDayID, taskDefinitionID",
        reminders: "id, workDayID",
      })
      .upgrade(async (tx) => {
        await tx
          .table("workDayTasks")
          .toCollection()
          .modify((wt: { isVisible?: boolean }) => {
            if (wt.isVisible === undefined) wt.isVisible = true;
          });
      });

    // v3: separates concrete timed work items (WorkDayEvent) from task tags
    // (WorkDayTask). Existing task assignments are preserved.
    this.version(3).stores({
      workDays: "id, &date, shiftID, modifiedAt",
      shiftDefinitions: "id, code, isActive",
      scheduleRules: "id, shiftID, priority, isActive",
      taskDefinitions: "id, code, isActive",
      workDayTasks: "id, workDayID, taskDefinitionID",
      workDayEvents: "id, workDayID, startTime, modifiedAt",
      reminders: "id, workDayID",
    });

    // v4: migrate legacy timed task assignments into concrete work events.
    // The Task assignment itself is intentionally preserved; only its old
    // timing/reminder metadata is copied to WorkDayEvent.
    this.version(4)
      .stores({
        workDays: "id, &date, shiftID, modifiedAt",
        shiftDefinitions: "id, code, isActive",
        scheduleRules: "id, shiftID, priority, isActive",
        taskDefinitions: "id, code, isActive",
        workDayTasks: "id, workDayID, taskDefinitionID",
        workDayEvents: "id, workDayID, startTime, modifiedAt",
        reminders: "id, workDayID",
      })
      .upgrade(async (tx) => {
        const [assignments, definitions] = await Promise.all([
          tx.table("workDayTasks").toArray(),
          tx.table("taskDefinitions").toArray(),
        ]);
        const taskById = new Map(
          definitions.map((task: { id: string; code: string; name: string }) => [task.id, task]),
        );
        const events = tx.table("workDayEvents");
        const now = new Date().toISOString();
        for (const assignment of assignments as {
          id: string;
          workDayID: string;
          taskDefinitionID: string;
          startTime?: string | null;
          endTime?: string | null;
          reminderEnabled?: boolean;
          reminderOffset?: string | null;
        }[]) {
          if (!assignment.startTime || !assignment.endTime) continue;
          const task = taskById.get(assignment.taskDefinitionID);
          await events.add({
            id: newId(),
            workDayID: assignment.workDayID,
            title: task?.name ?? task?.code ?? "Công việc",
            startTime: assignment.startTime,
            endTime: assignment.endTime,
            reminderEnabled: assignment.reminderEnabled ?? false,
            reminderOffset: assignment.reminderOffset ?? null,
            createdAt: now,
            modifiedAt: now,
          });
        }
      });

    // v5: adds cloud-sync stores. Purely additive — existing stores/data are
    // untouched. `syncQueue` holds pending local mutations; `syncMeta` holds
    // key/value sync state (deviceId, pull cursor, lastSyncedAt).
    this.version(5).stores({
      workDays: "id, &date, shiftID, modifiedAt",
      shiftDefinitions: "id, code, isActive",
      scheduleRules: "id, shiftID, priority, isActive",
      taskDefinitions: "id, code, isActive",
      workDayTasks: "id, workDayID, taskDefinitionID",
      workDayEvents: "id, workDayID, startTime, modifiedAt",
      reminders: "id, workDayID",
      // changeId is the primary key; index status/entity for queue queries.
      syncQueue: "changeId, status, entityType, entityId, createdAt",
      syncMeta: "key",
    });
  }
}

/** The shared application database instance. */
export const db = new ShiftFlowDB();
