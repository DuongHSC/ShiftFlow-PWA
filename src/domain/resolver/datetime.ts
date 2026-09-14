// ShiftFlow PWA — Domain Layer
// domain/resolver/datetime.ts
//
// Deterministic local-time-zone date helpers.
//
// Carries over the iOS invariant: a WorkDay's date is the START OF DAY in the
// user's LOCAL time zone, and all day-of-month rule checks use LOCAL calendar
// components. We deliberately avoid `new Date("YYYY-MM-DD")` (which parses as
// UTC) for date-only values, to prevent the "off-by-one day" class of bugs the
// iOS code fixed by pinning DateFormatter.timeZone = calendar.timeZone.

/** Start of the local day for a given Date. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Local day-of-month (1..31). */
export function localDayOfMonth(d: Date): number {
  return d.getDate();
}

/** Builds a Date at a specific hour/minute on the same LOCAL calendar day. */
export function dateTimeOnLocalDay(
  day: Date,
  hour: number,
  minute: number,
): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

/**
 * Formats a date-only value as "YYYY-MM-DD" using LOCAL components.
 * Used as the canonical WorkDay.date storage key.
 */
export function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parses a "YYYY-MM-DD" string into a LOCAL start-of-day Date.
 * Does NOT use Date(string) UTC parsing.
 */
export function fromISODateLocal(s: string): Date {
  const [y, m, d] = s.split("-").map((p) => parseInt(p, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** Formats a date as "DD/MM/YYYY" using LOCAL components (CSV date format). */
export function toDDMMYYYYLocal(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day}/${m}/${y}`;
}

/**
 * Parses "DD/MM/YYYY" (non-lenient) into a LOCAL start-of-day Date, or null.
 * Mirrors iOS ImportValidator.parseDate behavior.
 */
export function fromDDMMYYYYLocal(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject overflow (e.g. 31/02/2026 -> normalized to March).
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/** "HH:mm" 24-hour formatting of a Date (local). */
export function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

/** ISO string helper. */
export function nowISO(): string {
  return new Date().toISOString();
}
