// ShiftFlow PWA — Domain Layer
// domain/seed/seed.ts
//
// Default C1..C5 shift definitions, the C5 special schedule rule, and the
// default MW task. Values and stable IDs are ported verbatim from iOS
// ShiftSeedProvider.swift and TaskSeedProvider.swift so behavior is identical.
//
// Seeding is idempotent: only IDs not already present are added.

import type {
  ScheduleRule,
  ShiftColor,
  ShiftDefinition,
  TaskDefinition,
} from "@/domain/models/models";

// Stable IDs (identical to iOS) ensure idempotent seeding.
export const SEED_IDS = {
  c1: "00000001-0001-0001-0001-000000000001",
  c2: "00000002-0002-0002-0002-000000000002",
  c3: "00000003-0003-0003-0003-000000000003",
  c4: "00000004-0004-0004-0004-000000000004",
  c5: "00000005-0005-0005-0005-000000000005",
  c5SpecialRule: "00000005-0005-0005-0005-000000000050",
  mw: "00000010-0010-0010-0010-000000000010",
} as const;

function shift(
  id: string,
  code: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  breakStartHour: number,
  breakStartMinute: number,
  breakEndHour: number,
  breakEndMinute: number,
  color: ShiftColor,
  createdAt: string,
): ShiftDefinition {
  return {
    id,
    code,
    name: code,
    startHour,
    startMinute,
    endHour,
    endMinute,
    breakStartHour,
    breakStartMinute,
    breakEndHour,
    breakEndMinute,
    color,
    isActive: true,
    createdAt,
    modifiedAt: createdAt,
  };
}

/** The default five shift definitions (C1..C5), each with a distinct color. */
export function defaultShifts(createdAt: string): ShiftDefinition[] {
  return [
    // C1: 07:00-16:30, break 11:00-12:00
    shift(SEED_IDS.c1, "C1", 7, 0, 16, 30, 11, 0, 12, 0, "blue", createdAt),
    // C2: 07:30-17:00, break 11:30-12:30
    shift(SEED_IDS.c2, "C2", 7, 30, 17, 0, 11, 30, 12, 30, "green", createdAt),
    // C3: 08:00-17:30, break 12:00-13:00
    shift(SEED_IDS.c3, "C3", 8, 0, 17, 30, 12, 0, 13, 0, "orange", createdAt),
    // C4: 08:30-18:00, break 12:30-13:30
    shift(SEED_IDS.c4, "C4", 8, 30, 18, 0, 12, 30, 13, 30, "purple", createdAt),
    // C5 normal: 11:30-21:00, break 16:30-17:30
    shift(SEED_IDS.c5, "C5", 11, 30, 21, 0, 16, 30, 17, 30, "red", createdAt),
  ];
}

/**
 * The default schedule rules.
 * C5 special: day 10..20 inclusive -> 12:00-21:30, break 16:30-17:30, priority 1.
 */
export function defaultRules(createdAt: string): ScheduleRule[] {
  return [
    {
      id: SEED_IDS.c5SpecialRule,
      shiftID: SEED_IDS.c5,
      startDayOfMonth: 10,
      endDayOfMonth: 20,
      startHour: 12,
      startMinute: 0,
      endHour: 21,
      endMinute: 30,
      breakStartHour: 16,
      breakStartMinute: 30,
      breakEndHour: 17,
      breakEndMinute: 30,
      priority: 1,
      isActive: true,
      createdAt,
      modifiedAt: createdAt,
    },
  ];
}

/** Default task definitions (MW). */
export function defaultTasks(createdAt: string): TaskDefinition[] {
  return [
    {
      id: SEED_IDS.mw,
      code: "MW",
      name: "MW",
      isActive: true,
      createdAt,
      modifiedAt: createdAt,
    },
  ];
}
