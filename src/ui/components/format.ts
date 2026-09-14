// ShiftFlow PWA — UI
// ui/components/format.ts
//
// Presentation-only formatting + shift styling. No business rules here.
//
// Shift colors are driven by ShiftDefinition.color (via shiftColor domain
// helper), NOT hard-coded to C1..C5. Screens build a code->hex map from the
// live shiftDefinitions and pass it to badge helpers so any shift (C6, C7, Ca
// đêm, ...) renders with its configured color.

import type { ShiftDefinition, WorkDay } from "@/domain/models/models";
import { formatTime } from "@/domain/resolver/datetime";
import {
  OFF_COLOR,
  shiftDefinitionHex,
} from "@/domain/models/shiftColor";
import { el } from "@/ui/components/dom";

const WEEKDAYS_VI = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WEEKDAYS_FULL_VI = [
  "Chủ Nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];
const MONTHS_VI = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
];

/** A lookup from shift CODE to its display hex, built from live definitions. */
export type ShiftColorMap = Map<string, string>;

/** Builds a CODE -> hex color map from the current shift definitions. */
export function buildShiftColorMap(shifts: ShiftDefinition[]): ShiftColorMap {
  const map: ShiftColorMap = new Map();
  for (const s of shifts) map.set(s.code.toUpperCase(), shiftDefinitionHex(s));
  return map;
}

/** Resolves the display hex for a shift code (OFF/unknown -> neutral). */
export function colorForCode(code: string, colors?: ShiftColorMap): string {
  const c = (code || "").toUpperCase();
  if (!c || c === "OFF") return OFF_COLOR;
  return colors?.get(c) ?? OFF_COLOR;
}

/** Returns the current display name for a shift code, falling back to code. */
export function shiftName(
  code: string,
  shifts: Pick<ShiftDefinition, "code" | "name">[],
): string {
  const normalized = (code || "").trim().toUpperCase();
  const shift = shifts.find((s) => s.code.toUpperCase() === normalized);
  return shift?.name?.trim() || code;
}

/** Compact human-readable title used on schedule cards. */
export function shiftTitle(
  code: string,
  shifts: Pick<ShiftDefinition, "code" | "name">[],
): string {
  return shiftName(code, shifts);
}

/**
 * Builds a shift badge element. Color comes from the definitions map (not
 * hard-coded). The CODE text is always shown so shifts are distinguishable
 * without relying on color alone (accessibility).
 */
export function shiftBadge(
  code: string,
  colors?: ShiftColorMap,
  opts: { size?: "sm" | "md" | "lg" } = {},
): HTMLElement {
  const isOff = !(code || "").trim() || code.toUpperCase() === "OFF";
  const hex = colorForCode(code, colors);
  const label = isOff ? "OFF" : code;
  const sizeClass = opts.size ? ` ${opts.size}` : "";
  return el("span", {
    class: `shift-badge${sizeClass}`,
    style: `background:${hex}`,
    text: label,
  });
}

export function weekdayShort(d: Date): string {
  return WEEKDAYS_VI[d.getDay()];
}
export function weekdayFull(d: Date): string {
  return WEEKDAYS_FULL_VI[d.getDay()];
}
export function monthName(monthIndex: number): string {
  return MONTHS_VI[monthIndex];
}

export function longDate(d: Date): string {
  return `${weekdayFull(d)}, ${d.getDate()} ${MONTHS_VI[d.getMonth()]} ${d.getFullYear()}`;
}

export function timeFromISO(iso: string): string {
  return formatTime(new Date(iso));
}

export function workDayTimes(w: WorkDay): {
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
} {
  return {
    start: timeFromISO(w.resolvedStartDateTime),
    end: timeFromISO(w.resolvedEndDateTime),
    breakStart: timeFromISO(w.resolvedBreakStartDateTime),
    breakEnd: timeFromISO(w.resolvedBreakEndDateTime),
  };
}
