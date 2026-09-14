// ShiftFlow PWA — Domain Layer
// domain/resolver/shiftResolver.ts
//
// The single source of truth for shift schedule resolution.
// Ported from iOS Services/ShiftResolver.swift.
//
// Properties:
// - Deterministic: same inputs always produce the same output.
// - Pure: no side effects, no network, no UI, no storage.
//
// All features requiring working time (Today, Calendar, 3-Days, Reminder)
// MUST use this resolver. No feature may implement independent shift calculation.

import type {
  ResolvedShift,
  ScheduleRule,
  ShiftDefinition,
} from "@/domain/models/models";
import {
  dateTimeOnLocalDay,
  localDayOfMonth,
  startOfLocalDay,
  toISODateLocal,
} from "./datetime";

/** Whether a rule applies to a given day-of-month (inclusive both ends). */
export function ruleApplies(rule: ScheduleRule, dayOfMonth: number): boolean {
  if (!rule.isActive) return false;
  return dayOfMonth >= rule.startDayOfMonth && dayOfMonth <= rule.endDayOfMonth;
}

/**
 * Resolves the concrete schedule for a given date and shift definition.
 *
 * - Finds active rules matching the LOCAL day-of-month.
 * - If multiple match, the highest `priority` wins.
 * - If none match, the shift definition's default times are used.
 *
 * This exactly mirrors the iOS resolver, including the inclusive C5 day 10..20
 * boundary behavior (day 9 -> normal, 10 -> special, 20 -> special, 21 -> normal).
 */
export function resolveShift(
  date: Date,
  shift: ShiftDefinition,
  rules: ScheduleRule[],
): ResolvedShift {
  const day = startOfLocalDay(date);
  const dayOfMonth = localDayOfMonth(day);

  const matchingRule = rules
    .filter((r) => ruleApplies(r, dayOfMonth))
    .sort((a, b) => b.priority - a.priority)[0];

  const eff = matchingRule
    ? {
        startHour: matchingRule.startHour,
        startMinute: matchingRule.startMinute,
        endHour: matchingRule.endHour,
        endMinute: matchingRule.endMinute,
        breakStartHour: matchingRule.breakStartHour,
        breakStartMinute: matchingRule.breakStartMinute,
        breakEndHour: matchingRule.breakEndHour,
        breakEndMinute: matchingRule.breakEndMinute,
      }
    : {
        startHour: shift.startHour,
        startMinute: shift.startMinute,
        endHour: shift.endHour,
        endMinute: shift.endMinute,
        breakStartHour: shift.breakStartHour,
        breakStartMinute: shift.breakStartMinute,
        breakEndHour: shift.breakEndHour,
        breakEndMinute: shift.breakEndMinute,
      };

  const start = dateTimeOnLocalDay(day, eff.startHour, eff.startMinute);
  const end = dateTimeOnLocalDay(day, eff.endHour, eff.endMinute);
  const breakStart = dateTimeOnLocalDay(
    day,
    eff.breakStartHour,
    eff.breakStartMinute,
  );
  const breakEnd = dateTimeOnLocalDay(day, eff.breakEndHour, eff.breakEndMinute);

  return {
    shiftID: shift.id,
    shiftCode: shift.code,
    date: toISODateLocal(day),
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    breakStartDateTime: breakStart.toISOString(),
    breakEndDateTime: breakEnd.toISOString(),
  };
}
