// ShiftFlow PWA — Services
// services/tasks/taskService.ts
//
// Task definitions + WorkDay↔task assignments. Ported from iOS TaskService.
//
// CRITICAL INVARIANTS:
// - Task operations NEVER resolve shifts.
// - Task operations NEVER modify WorkDay resolved snapshots.
// - Task is NEVER stored in WorkDay.note.

import type { TaskDefinition, WorkDayTask } from "@/domain/models/models";
import {
  TaskDefinitionRepository,
  WorkDayTaskRepository,
} from "@/storage/repositories/repositories";
import { nowISO } from "@/domain/resolver/datetime";
import { newId } from "@/services/id";
import type { EntityChangeSink } from "@/sync/changeSink";

export class TaskError extends Error {
  constructor(
    public code:
      | "emptyCode"
      | "emptyName"
      | "duplicateCode"
      | "notFound"
      | "taskInUse",
    message: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

export class TaskService {
  constructor(
    private defs: TaskDefinitionRepository,
    private assigns: WorkDayTaskRepository,
    private changes?: EntityChangeSink,
  ) {}

  private async recordDef(t: TaskDefinition, op: "CREATE" | "UPDATE"): Promise<void> {
    await this.changes?.record({
      entityType: "TaskDefinition",
      entityId: t.id,
      operation: op,
      payload: { ...t },
    });
  }
  private async recordAssign(a: WorkDayTask, op: "CREATE" | "UPDATE"): Promise<void> {
    await this.changes?.record({
      entityType: "WorkDayTask",
      entityId: a.id,
      operation: op,
      payload: { ...a },
    });
  }
  private async recordAssignDelete(id: string): Promise<void> {
    await this.changes?.record({
      entityType: "WorkDayTask",
      entityId: id,
      operation: "DELETE",
      payload: null,
    });
  }

  allTasks(): Promise<TaskDefinition[]> {
    return this.defs.all();
  }

  async activeTasks(): Promise<TaskDefinition[]> {
    return (await this.defs.all())
      .filter((t) => t.isActive)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async taskByCode(code: string): Promise<TaskDefinition | undefined> {
    const upper = code.toUpperCase();
    return (await this.defs.all()).find((t) => t.code.toUpperCase() === upper);
  }

  async createTask(code: string, name: string): Promise<TaskDefinition> {
    const c = code.trim();
    const n = name.trim();
    if (!c) throw new TaskError("emptyCode", "Mã task không được để trống");
    if (!n) throw new TaskError("emptyName", "Tên task không được để trống");
    const all = await this.defs.all();
    if (all.some((t) => t.code.toUpperCase() === c.toUpperCase())) {
      throw new TaskError("duplicateCode", `Mã task đã tồn tại: ${c}`);
    }
    const now = nowISO();
    const task: TaskDefinition = {
      id: newId(),
      code: c,
      name: n,
      isActive: true,
      createdAt: now,
      modifiedAt: now,
    };
    await this.defs.put(task);
    await this.recordDef(task, "CREATE");
    return task;
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    const all = await this.defs.all();
    const existing = all.find((t) => t.id === id);
    if (!existing) throw new TaskError("notFound", "Không tìm thấy task");
    const updated = { ...existing, isActive, modifiedAt: nowISO() };
    await this.defs.put(updated);
    await this.recordDef(updated, "UPDATE");
  }

  /**
   * Deletes a task definition. If historical WorkDay assignments reference it,
   * soft-delete by deactivating the definition so old days remain readable.
   */
  async deleteTask(id: string): Promise<"deleted" | "deactivated"> {
    const all = await this.defs.all();
    const existing = all.find((t) => t.id === id);
    if (!existing) throw new TaskError("notFound", "Không tìm thấy task");
    const referenced = (await this.assigns.all()).some(
      (a) => a.taskDefinitionID === id,
    );
    if (referenced) {
      const deactivated = { ...existing, isActive: false, modifiedAt: nowISO() };
      await this.defs.put(deactivated);
      await this.recordDef(deactivated, "UPDATE");
      return "deactivated";
    }
    await this.defs.delete(id);
    await this.changes?.record({
      entityType: "TaskDefinition",
      entityId: id,
      operation: "DELETE",
      payload: null,
    });
    return "deleted";
  }

  // MARK: assignments

  /** All assigned task definitions for a WorkDay (visible + hidden). */
  async tasksForWorkDay(workDayID: string): Promise<TaskDefinition[]> {
    const joins = await this.assigns.forWorkDay(workDayID);
    const all = await this.defs.all();
    const byId = new Map(all.map((t) => [t.id, t]));
    return joins
      .map((j) => byId.get(j.taskDefinitionID))
      .filter((t): t is TaskDefinition => !!t);
  }

  /**
   * Assigned tasks paired with their assignment (incl. visibility). This is the
   * single source of truth Overview and Calendar read from. `isVisible`
   * defaults to true for records created before the field existed.
   */
  async assignmentsForWorkDay(
    workDayID: string,
  ): Promise<{ task: TaskDefinition; assignment: WorkDayTask; isVisible: boolean }[]> {
    const joins = await this.assigns.forWorkDay(workDayID);
    const all = await this.defs.all();
    const byId = new Map(all.map((t) => [t.id, t]));
    const out: { task: TaskDefinition; assignment: WorkDayTask; isVisible: boolean }[] = [];
    for (const j of joins) {
      const task = byId.get(j.taskDefinitionID);
      if (task) out.push({ task, assignment: j, isVisible: j.isVisible !== false });
    }
    return out;
  }

  /** Only VISIBLE assigned task definitions (read surfaces: Overview, Calendar). */
  async visibleTasksForWorkDay(workDayID: string): Promise<TaskDefinition[]> {
    return (await this.assignmentsForWorkDay(workDayID))
      .filter((a) => a.isVisible)
      .map((a) => a.task);
  }

  async hasTask(workDayID: string): Promise<boolean> {
    return (await this.assigns.forWorkDay(workDayID)).length > 0;
  }

  /** Whether a WorkDay has at least one VISIBLE assigned task. */
  async hasVisibleTask(workDayID: string): Promise<boolean> {
    return (await this.visibleTasksForWorkDay(workDayID)).length > 0;
  }

  /** Idempotent: no duplicate join for the same (workDay, task) pair. New assignments are visible. */
  async addTask(taskDefinitionID: string, workDayID: string): Promise<void> {
    const existing = await this.assigns.forWorkDay(workDayID);
    if (existing.some((a) => a.taskDefinitionID === taskDefinitionID)) return;
    const now = nowISO();
    const join: WorkDayTask = {
      id: newId(),
      workDayID,
      taskDefinitionID,
      isVisible: true,
      createdAt: now,
      modifiedAt: now,
    };
    await this.assigns.put(join);
    await this.recordAssign(join, "CREATE");
  }

  /**
   * Hides/unhides a task assignment WITHOUT deleting it. This is the only
   * visibility control — there is no per-screen preference. No-op if the pair
   * is not assigned.
   */
  async setTaskVisibility(
    taskDefinitionID: string,
    workDayID: string,
    isVisible: boolean,
  ): Promise<void> {
    const joins = (await this.assigns.forWorkDay(workDayID)).filter(
      (a) => a.taskDefinitionID === taskDefinitionID,
    );
    for (const j of joins) {
      const updated = { ...j, isVisible, modifiedAt: nowISO() };
      await this.assigns.put(updated);
      await this.recordAssign(updated, "UPDATE");
    }
  }

  async setTaskDetails(
    taskDefinitionID: string,
    workDayID: string,
    details: Pick<
      WorkDayTask,
      "startTime" | "endTime" | "reminderEnabled" | "reminderOffset"
    >,
  ): Promise<void> {
    // Legacy compatibility for records created before timed work was split
    // into WorkDayEvent. New UI flows write timing/reminders to events only.
    const joins = (await this.assigns.forWorkDay(workDayID)).filter(
      (a) => a.taskDefinitionID === taskDefinitionID,
    );
    for (const j of joins) {
      const updated = { ...j, ...details, modifiedAt: nowISO() };
      await this.assigns.put(updated);
      await this.recordAssign(updated, "UPDATE");
    }
  }

  async removeTask(taskDefinitionID: string, workDayID: string): Promise<void> {
    const joins = (await this.assigns.forWorkDay(workDayID)).filter(
      (a) => a.taskDefinitionID === taskDefinitionID,
    );
    for (const j of joins) {
      await this.assigns.delete(j.id);
      await this.recordAssignDelete(j.id);
    }
  }

  async removeAllTasks(workDayID: string): Promise<void> {
    const joins = await this.assigns.forWorkDay(workDayID);
    await this.assigns.deleteForWorkDay(workDayID);
    for (const j of joins) await this.recordAssignDelete(j.id);
  }

  async workDayIDsWithTasks(): Promise<Set<string>> {
    return new Set((await this.assigns.all()).map((a) => a.workDayID));
  }

  /** WorkDay IDs that have at least one VISIBLE assigned task (calendar dots). */
  async workDayIDsWithVisibleTasks(): Promise<Set<string>> {
    return new Set(
      (await this.assigns.all())
        .filter((a) => a.isVisible !== false)
        .map((a) => a.workDayID),
    );
  }
}
