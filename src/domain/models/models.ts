// ShiftFlow PWA — Domain Layer
// domain/models/models.ts
//
// Pure domain value types, ported from the iOS ShiftFlow domain package.
// These are framework-independent: no Dexie, no DOM, no UI.
//
// Behavioral reference (iOS):
//   ShiftDefinition.swift, ScheduleRule.swift, ResolvedShift.swift,
//   WorkDay.swift, TaskDefinition.swift
//
// DATE/TIME REPRESENTATION
// ------------------------
// The iOS app stores Date values. In the PWA we store dates as ISO strings and
// work with `Date` at runtime. The critical invariant carried over from iOS:
// a WorkDay's `date` is the START OF DAY in the user's local time zone. All
// day-of-month logic uses local calendar components (see resolver).

/**
 * Named color palette for shifts. Stored as a stable key on ShiftDefinition
 * (presentation only — never affects resolution). Kept as string keys so
 * backups/CSV are human-readable and forward-compatible.
 */
export const SHIFT_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "teal",
  "pink",
  "indigo",
] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];

/** A configurable shift definition (e.g. C1..C5). */
export interface ShiftDefinition {
  id: string;
  /** Stable business identity, e.g. "C1". Never changes on edit. */
  code: string;
  name: string;

  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  breakStartHour: number;
  breakStartMinute: number;
  breakEndHour: number;
  breakEndMinute: number;

  /**
   * Presentation color (palette key). Optional for backward compatibility with
   * records created before this field existed; the UI falls back to a
   * deterministic color derived from the shift when absent. Never affects
   * schedule resolution, reminders, CSV, or any business logic.
   */
  color?: ShiftColor;

  isActive: boolean;
  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

/**
 * A conditional schedule override for a shift.
 * When day-of-month is within [startDayOfMonth, endDayOfMonth] (inclusive),
 * these times override the shift definition defaults.
 * Example: C5 uses different times on calendar days 10..20.
 */
export interface ScheduleRule {
  id: string;
  shiftID: string;

  startDayOfMonth: number; // 1..31 inclusive
  endDayOfMonth: number; // 1..31 inclusive

  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  breakStartHour: number;
  breakStartMinute: number;
  breakEndHour: number;
  breakEndMinute: number;

  /** Higher priority wins when ranges overlap. */
  priority: number;
  isActive: boolean;

  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

/**
 * The fully resolved schedule for a specific date and shift.
 * Output of ShiftResolver.resolve(...). NOT user configuration.
 */
export interface ResolvedShift {
  shiftID: string;
  shiftCode: string;
  /** ISO date (start of local day). */
  date: string;
  startDateTime: string; // ISO
  endDateTime: string; // ISO
  breakStartDateTime: string; // ISO
  breakEndDateTime: string; // ISO
}

/**
 * The primary scheduled work record. Stores a historical snapshot of resolved
 * working times. Changing global ShiftDefinition must NOT rewrite existing
 * WorkDays; the snapshot is recalculated only on create or explicit shift change.
 */
export interface WorkDay {
  id: string;
  /** ISO date (start of local day). At most one WorkDay per calendar date. */
  date: string;
  shiftID: string;
  shiftCode: string;

  // Historical snapshot (ISO date-times):
  resolvedStartDateTime: string;
  resolvedEndDateTime: string;
  resolvedBreakStartDateTime: string;
  resolvedBreakEndDateTime: string;

  /** Optional plain-text note. Does not influence schedule resolution. */
  note?: string | null;

  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

/** A configurable task type (e.g. "MW"). Carries no schedule information. */
export interface TaskDefinition {
  id: string;
  /** Stable code, e.g. "MW". Immutable after creation. */
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

/**
 * Assignment of a TaskDefinition to a WorkDay. Join record only — assigning or
 * removing it never changes the WorkDay's resolved times.
 */
export interface WorkDayTask {
  id: string;
  workDayID: string;
  taskDefinitionID: string;
  /**
   * Whether this assignment is shown in read surfaces (Overview, Calendar).
   * Hiding an assignment does NOT delete it. Optional for backward
   * compatibility with records created before this field existed; absence is
   * treated as `true` (visible). This is the single source of truth for task
   * visibility — there is no per-screen visibility preference.
   */
  isVisible?: boolean;
  /**
   * Legacy task timing retained for backup/migration compatibility.
   * New timed items belong to WorkDayEvent and the UI never edits these fields.
   */
  startTime?: string | null;
  endTime?: string | null;
  reminderOffset?: ReminderOffset | null;
  reminderEnabled?: boolean;
  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

/** A concrete timed item on one WorkDay, e.g. "Meeting 14:00-20:00". */
export interface WorkDayEvent {
  id: string;
  workDayID: string;
  title: string;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  reminderOffset?: ReminderOffset | null;
  reminderEnabled?: boolean;
  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

/** Supported reminder offsets relative to WorkDay.resolvedStartDateTime. */
export type ReminderOffset =
  | "at_start"
  | "30min"
  | "1h"
  | "2h"
  | "24h";

/**
 * Reminder configuration for a WorkDay. Timing = resolvedStartDateTime + offset.
 * Persisted (M1 stores the preference); actual delivery is out of M1 scope.
 */
export interface ReminderConfiguration {
  id: string;
  workDayID: string;
  offset: ReminderOffset;
  isEnabled: boolean;
  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

/** Valid shift codes accepted by the importer (mirrors iOS ImportValidator). */
export const VALID_SHIFT_CODES = ["C1", "C2", "C3", "C4", "C5", "OFF"] as const;
export type ValidShiftCode = (typeof VALID_SHIFT_CODES)[number];
