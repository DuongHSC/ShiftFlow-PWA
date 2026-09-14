// ShiftFlow PWA — Domain Layer
// domain/resolver/reminderTiming.ts
//
// Pure reminder timing math, ported from iOS ReminderModels.swift.
// Timing is derived ONLY from WorkDay.resolvedStartDateTime + offset.
// Actual delivery (Web Notifications) is out of M1 scope.

import type { ReminderOffset } from "@/domain/models/models";

/** Offset in milliseconds (negative = before start). */
export function offsetMillis(offset: ReminderOffset): number {
  switch (offset) {
    case "at_start":
      return 0;
    case "30min":
      return -30 * 60 * 1000;
    case "1h":
      return -60 * 60 * 1000;
    case "2h":
      return -2 * 60 * 60 * 1000;
    case "24h":
      return -24 * 60 * 60 * 1000;
  }
}

/** Vietnamese display label for an offset. */
export function offsetLabel(offset: ReminderOffset): string {
  switch (offset) {
    case "at_start":
      return "Lúc bắt đầu";
    case "30min":
      return "30 phút trước";
    case "1h":
      return "1 giờ trước";
    case "2h":
      return "2 giờ trước";
    case "24h":
      return "24 giờ trước";
  }
}

/** The date/time at which a reminder should fire. */
export function reminderFireDate(
  resolvedStartDateTime: string,
  offset: ReminderOffset,
): Date {
  const start = new Date(resolvedStartDateTime).getTime();
  return new Date(start + offsetMillis(offset));
}

export const ALL_REMINDER_OFFSETS: ReminderOffset[] = [
  "at_start",
  "30min",
  "1h",
  "2h",
  "24h",
];
