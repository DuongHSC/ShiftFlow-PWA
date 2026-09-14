// ShiftFlow PWA — Services
// services/settings/shiftConfigurationService.ts
//
// User-editable shift definitions and schedule rules, plus the shift lookup
// used by resolution (mirrors iOS ShiftConfigurationService + ShiftDefinitionProvider).
//
// Editing configuration affects FUTURE WorkDay resolution only. It never
// rewrites existing WorkDay snapshots (that invariant is enforced in
// WorkDayService — config edits here simply do not touch WorkDays).

import type {
  ScheduleRule,
  ShiftColor,
  ShiftDefinition,
} from "@/domain/models/models";
import {
  ScheduleRuleRepository,
  ShiftDefinitionRepository,
  WorkDayRepository,
} from "@/storage/repositories/repositories";
import { nowISO } from "@/domain/resolver/datetime";
import { newId } from "@/services/id";
import type { EntityChangeSink } from "@/sync/changeSink";

export interface ShiftLookupResult {
  shift: ShiftDefinition;
  rules: ScheduleRule[];
}

export class ShiftConfigError extends Error {
  constructor(
    public code: "emptyCode" | "duplicateCode" | "shiftInUse" | "notFound",
    message: string,
  ) {
    super(message);
    this.name = "ShiftConfigError";
  }
}

export interface NewShiftInput {
  code: string;
  name?: string;
  color: ShiftColor;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  breakStartHour: number;
  breakStartMinute: number;
  breakEndHour: number;
  breakEndMinute: number;
}

export class ShiftConfigurationService {
  constructor(
    private shifts: ShiftDefinitionRepository,
    private rules: ScheduleRuleRepository,
    private workDays?: WorkDayRepository,
    private changes?: EntityChangeSink,
  ) {}

  private async recordShift(s: ShiftDefinition, op: "CREATE" | "UPDATE"): Promise<void> {
    await this.changes?.record({
      entityType: "ShiftDefinition",
      entityId: s.id,
      operation: op,
      payload: { ...s },
    });
  }
  private async recordRule(r: ScheduleRule, op: "CREATE" | "UPDATE"): Promise<void> {
    await this.changes?.record({
      entityType: "ScheduleRule",
      entityId: r.id,
      operation: op,
      payload: { ...r },
    });
  }

  allShifts(): Promise<ShiftDefinition[]> {
    return this.shifts.all();
  }

  allRules(): Promise<ScheduleRule[]> {
    return this.rules.all();
  }

  async activeShifts(): Promise<ShiftDefinition[]> {
    return (await this.shifts.all())
      .filter((s) => s.isActive)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Resolve a shift code to its definition and applicable rules. */
  async lookup(code: string): Promise<ShiftLookupResult | null> {
    const normalized = code.trim().toUpperCase();
    const shift = (await this.shifts.all()).find(
      (s) => s.code.toUpperCase() === normalized,
    );
    if (!shift) return null;
    const rules = (await this.rules.all()).filter((r) => r.shiftID === shift.id);
    return { shift, rules };
  }

  /** Updates a shift's editable fields. Code/id are stable. */
  async updateShift(updated: ShiftDefinition): Promise<void> {
    const rec = { ...updated, modifiedAt: nowISO() };
    await this.shifts.put(rec);
    await this.recordShift(rec, "UPDATE");
  }

  /**
   * Creates a NEW shift definition (e.g. C6, C7, "Ca đêm"). Additive only — does
   * not touch existing shifts, WorkDays, or resolution behavior. Rejects an
   * empty or duplicate code.
   */
  async createShift(input: NewShiftInput): Promise<ShiftDefinition> {
    const code = input.code.trim();
    if (!code) throw new ShiftConfigError("emptyCode", "Mã ca không được để trống");
    const existing = await this.shifts.all();
    if (existing.some((s) => s.code.toUpperCase() === code.toUpperCase())) {
      throw new ShiftConfigError("duplicateCode", `Mã ca đã tồn tại: ${code}`);
    }
    const now = nowISO();
    const shift: ShiftDefinition = {
      id: newId(),
      code,
      name: (input.name && input.name.trim()) || code,
      startHour: input.startHour,
      startMinute: input.startMinute,
      endHour: input.endHour,
      endMinute: input.endMinute,
      breakStartHour: input.breakStartHour,
      breakStartMinute: input.breakStartMinute,
      breakEndHour: input.breakEndHour,
      breakEndMinute: input.breakEndMinute,
      color: input.color,
      isActive: true,
      createdAt: now,
      modifiedAt: now,
    };
    await this.shifts.put(shift);
    await this.recordShift(shift, "CREATE");
    return shift;
  }

  /** Updates a schedule rule's editable fields. id/shiftID stable. */
  async updateRule(updated: ScheduleRule): Promise<void> {
    const rec = { ...updated, modifiedAt: nowISO() };
    await this.rules.put(rec);
    await this.recordRule(rec, "UPDATE");
  }

  /**
   * Deletes a shift definition and its associated schedule rules.
   *
   * A shift referenced by historical WorkDays is soft-deleted instead:
   * it is marked inactive while the WorkDay snapshots remain intact.
   * Unused shifts are removed together with their rules.
   */
  async deleteShift(id: string): Promise<"deleted" | "deactivated"> {
    const existing = (await this.shifts.all()).find((s) => s.id === id);
    if (!existing) {
      throw new ShiftConfigError("notFound", "Không tìm thấy ca");
    }
    if (this.workDays) {
      const usedBy = (await this.workDays.all()).filter((w) => w.shiftID === id).length;
      if (usedBy > 0) {
        const deactivated = { ...existing, isActive: false, modifiedAt: nowISO() };
        await this.shifts.put(deactivated);
        await this.recordShift(deactivated, "UPDATE");
        return "deactivated";
      }
    }
    const rules = (await this.rules.all()).filter((r) => r.shiftID === id);
    for (const r of rules) {
      await this.rules.delete(r.id);
      await this.changes?.record({
        entityType: "ScheduleRule",
        entityId: r.id,
        operation: "DELETE",
        payload: null,
      });
    }
    await this.shifts.delete(id);
    await this.changes?.record({
      entityType: "ShiftDefinition",
      entityId: id,
      operation: "DELETE",
      payload: null,
    });
    return "deleted";
  }
}
