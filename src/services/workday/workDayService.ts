// ShiftFlow PWA — Services
// services/workday/workDayService.ts
//
// Coordinates WorkDay CRUD with the resolver. Ported from iOS WorkDayService.
//
// HISTORICAL SNAPSHOT STRATEGY (critical):
// - Create: resolve + snapshot.
// - Explicit shift change: re-resolve + update snapshot.
// - Note edit: snapshot untouched.
// - Global config change: NO automatic recalculation (this service never
//   rewrites snapshots outside create/changeShift).
//
// "One WorkDay per date" is enforced here (Dexie also has a unique date index).

import type {
  ScheduleRule,
  ShiftDefinition,
  WorkDay,
} from "@/domain/models/models";
import { WorkDayRepository } from "@/storage/repositories/repositories";
import { resolveShift } from "@/domain/resolver/shiftResolver";
import {
  fromISODateLocal,
  nowISO,
  startOfLocalDay,
  toISODateLocal,
} from "@/domain/resolver/datetime";
import { newId } from "@/services/id";
import type { EntityChangeSink } from "@/sync/changeSink";

export class DuplicateDateError extends Error {
  constructor(public isoDate: string) {
    super(`A WorkDay already exists for ${isoDate}`);
    this.name = "DuplicateDateError";
  }
}

export class WorkDayNotFoundError extends Error {
  constructor(public id: string) {
    super(`WorkDay not found: ${id}`);
    this.name = "WorkDayNotFoundError";
  }
}

export class WorkDayService {
  /** Optional sync sink — enqueues cloud changes. Omitted in unit tests. */
  constructor(
    private repo: WorkDayRepository,
    private changes?: EntityChangeSink,
  ) {}

  private normalize(date: Date): string {
    return toISODateLocal(startOfLocalDay(date));
  }

  private async recordUpsert(w: WorkDay): Promise<void> {
    await this.changes?.record({
      entityType: "WorkDay",
      entityId: w.id,
      operation: "UPDATE",
      payload: { ...w },
    });
  }

  all(): Promise<WorkDay[]> {
    return this.repo.all();
  }

  byId(id: string): Promise<WorkDay | undefined> {
    return this.repo.byId(id);
  }

  byDate(date: Date): Promise<WorkDay | undefined> {
    return this.repo.byDate(this.normalize(date));
  }

  byDateRange(start: Date, end: Date): Promise<WorkDay[]> {
    return this.repo.byDateRange(this.normalize(start), this.normalize(end));
  }

  /** Creates a new WorkDay with a resolved snapshot. Throws on duplicate date. */
  async create(
    date: Date,
    shift: ShiftDefinition,
    rules: ScheduleRule[],
    note?: string | null,
  ): Promise<WorkDay> {
    const isoDate = this.normalize(date);
    const existing = await this.repo.byDate(isoDate);
    if (existing) throw new DuplicateDateError(isoDate);

    const resolved = resolveShift(fromISODateLocal(isoDate), shift, rules);
    const now = nowISO();
    const workDay: WorkDay = {
      id: newId(),
      date: isoDate,
      shiftID: resolved.shiftID,
      shiftCode: resolved.shiftCode,
      resolvedStartDateTime: resolved.startDateTime,
      resolvedEndDateTime: resolved.endDateTime,
      resolvedBreakStartDateTime: resolved.breakStartDateTime,
      resolvedBreakEndDateTime: resolved.breakEndDateTime,
      note: note ?? null,
      createdAt: now,
      modifiedAt: now,
    };
    await this.repo.put(workDay);
    await this.changes?.record({
      entityType: "WorkDay",
      entityId: workDay.id,
      operation: "CREATE",
      payload: { ...workDay },
    });
    return workDay;
  }

  /**
   * Explicit shift change — the ONLY approved path (besides create) that
   * updates a WorkDay's resolved snapshot. Re-resolves for the existing date.
   */
  async changeShift(
    workDayID: string,
    newShift: ShiftDefinition,
    rules: ScheduleRule[],
  ): Promise<WorkDay> {
    const existing = await this.repo.byId(workDayID);
    if (!existing) throw new WorkDayNotFoundError(workDayID);

    const resolved = resolveShift(
      fromISODateLocal(existing.date),
      newShift,
      rules,
    );
    const updated: WorkDay = {
      ...existing,
      shiftID: resolved.shiftID,
      shiftCode: resolved.shiftCode,
      resolvedStartDateTime: resolved.startDateTime,
      resolvedEndDateTime: resolved.endDateTime,
      resolvedBreakStartDateTime: resolved.breakStartDateTime,
      resolvedBreakEndDateTime: resolved.breakEndDateTime,
      modifiedAt: nowISO(),
    };
    await this.repo.put(updated);
    await this.recordUpsert(updated);
    return updated;
  }

  /** Updates the note. Does NOT modify the resolved snapshot. */
  async updateNote(workDayID: string, note: string | null): Promise<WorkDay> {
    const existing = await this.repo.byId(workDayID);
    if (!existing) throw new WorkDayNotFoundError(workDayID);
    const updated: WorkDay = {
      ...existing,
      note: note ?? null,
      modifiedAt: nowISO(),
    };
    await this.repo.put(updated);
    await this.recordUpsert(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
    await this.changes?.record({
      entityType: "WorkDay",
      entityId: id,
      operation: "DELETE",
      payload: null,
    });
  }
}
