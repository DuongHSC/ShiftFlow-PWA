// ShiftFlow PWA — Tests
// tests/resolver.test.ts
//
// C1..C5 resolution and the critical C5 day 9/10/20/21 boundary.

import { describe, it, expect } from "vitest";
import { resolveShift } from "@/domain/resolver/shiftResolver";
import { defaultRules, defaultShifts, SEED_IDS } from "@/domain/seed/seed";
import { formatTime } from "@/domain/resolver/datetime";

const CREATED = "2026-01-01T00:00:00.000Z";
const shifts = defaultShifts(CREATED);
const rules = defaultRules(CREATED);

function shift(code: string) {
  const s = shifts.find((x) => x.code === code);
  if (!s) throw new Error(`no shift ${code}`);
  return s;
}

function rulesFor(shiftID: string) {
  return rules.filter((r) => r.shiftID === shiftID);
}

function times(date: Date, code: string) {
  const s = shift(code);
  const r = resolveShift(date, s, rulesFor(s.id));
  return {
    start: formatTime(new Date(r.startDateTime)),
    end: formatTime(new Date(r.endDateTime)),
    breakStart: formatTime(new Date(r.breakStartDateTime)),
    breakEnd: formatTime(new Date(r.breakEndDateTime)),
  };
}

describe("C1..C5 default resolution", () => {
  const day = new Date(2026, 7, 5); // Aug 5, 2026 (outside C5 special window)

  it("C1 resolves to 07:00-16:30 break 11:00-12:00", () => {
    expect(times(day, "C1")).toEqual({
      start: "07:00",
      end: "16:30",
      breakStart: "11:00",
      breakEnd: "12:00",
    });
  });

  it("C2 resolves to 07:30-17:00 break 11:30-12:30", () => {
    expect(times(day, "C2")).toEqual({
      start: "07:30",
      end: "17:00",
      breakStart: "11:30",
      breakEnd: "12:30",
    });
  });

  it("C3 resolves to 08:00-17:30 break 12:00-13:00", () => {
    expect(times(day, "C3")).toEqual({
      start: "08:00",
      end: "17:30",
      breakStart: "12:00",
      breakEnd: "13:00",
    });
  });

  it("C4 resolves to 08:30-18:00 break 12:30-13:30", () => {
    expect(times(day, "C4")).toEqual({
      start: "08:30",
      end: "18:00",
      breakStart: "12:30",
      breakEnd: "13:30",
    });
  });

  it("C5 normal resolves to 11:30-21:00 break 16:30-17:30", () => {
    expect(times(day, "C5")).toEqual({
      start: "11:30",
      end: "21:00",
      breakStart: "16:30",
      breakEnd: "17:30",
    });
  });
});

describe("C5 special schedule boundary (day 10..20 inclusive)", () => {
  it("day 9 -> normal (11:30-21:00)", () => {
    const t = times(new Date(2026, 7, 9), "C5");
    expect(t.start).toBe("11:30");
    expect(t.end).toBe("21:00");
  });

  it("day 10 -> special (12:00-21:30)", () => {
    const t = times(new Date(2026, 7, 10), "C5");
    expect(t.start).toBe("12:00");
    expect(t.end).toBe("21:30");
  });

  it("day 20 -> special (12:00-21:30)", () => {
    const t = times(new Date(2026, 7, 20), "C5");
    expect(t.start).toBe("12:00");
    expect(t.end).toBe("21:30");
  });

  it("day 21 -> normal (11:30-21:00)", () => {
    const t = times(new Date(2026, 7, 21), "C5");
    expect(t.start).toBe("11:30");
    expect(t.end).toBe("21:00");
  });

  it("rule is evaluated per-month (February day 15 special)", () => {
    const t = times(new Date(2026, 1, 15), "C5");
    expect(t.start).toBe("12:00");
    expect(t.end).toBe("21:30");
  });

  it("break unchanged in special window (16:30-17:30)", () => {
    const t = times(new Date(2026, 7, 15), "C5");
    expect(t.breakStart).toBe("16:30");
    expect(t.breakEnd).toBe("17:30");
  });

  it("C5 rule targets only C5 (seed sanity)", () => {
    expect(rules[0].shiftID).toBe(SEED_IDS.c5);
  });
});
