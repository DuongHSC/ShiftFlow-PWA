// ShiftFlow PWA — Import/Export
// import-export/csv/csv.ts
//
// CSV parse / validate / export, ported from iOS ShiftFileParser,
// ImportValidator, and ShiftExportService. CSV is the WorkDay/calendar
// exchange format. Format is NOT redesigned.
//
// Columns: Date | Shift | Task | Note
// Date format: DD/MM/YYYY. Shift cells accept C1..C5/OFF, configured shift
// names (e.g. "Ca 5"), and blank cells for OFF.
// Header detection is case-insensitive (Date/Ngày/Ngay, Shift/Ca).
// Import delimiter auto-detected from the header: , \t | ;

import { VALID_SHIFT_CODES } from "@/domain/models/models";
import { fromDDMMYYYYLocal, toDDMMYYYYLocal, toISODateLocal } from "@/domain/resolver/datetime";

// ---- Raw parse ----

export interface CsvRawRow {
  rowNumber: number; // 1-based, header is row 1
  dateString: string | null;
  shiftString: string | null;
  taskString: string | null;
  noteString: string | null;
}

export type CsvParseErrorKind =
  | "emptyFile"
  | "invalidHeader"
  | "unsupportedFormat";

export class CsvParseError extends Error {
  constructor(public kind: CsvParseErrorKind, message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

const DATE_HEADERS = new Set(["date", "ngày", "ngay"]);
const SHIFT_HEADERS = new Set(["shift", "ca"]);
const DELIMITERS = [",", "\t", "|", ";"];

function detectDelimiter(headerLine: string): string | null {
  for (const d of DELIMITERS) if (headerLine.includes(d)) return d;
  return null;
}

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((c) => c.trim());
}

function isValidHeader(cols: string[]): boolean {
  if (cols.length < 2) return false;
  const first = cols[0].toLowerCase().trim();
  const second = cols[1].toLowerCase().trim();
  return DATE_HEADERS.has(first) && SHIFT_HEADERS.has(second);
}

function normalizeCell(v: string): string | null {
  const t = v.trim();
  return t.length ? t : null;
}

/** Parses CSV text content into raw rows. Throws CsvParseError on structure issues. */
export function parseCsv(content: string): CsvRawRow[] {
  const trimmed = content.trim();
  if (!trimmed) throw new CsvParseError("emptyFile", "File rỗng");

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) throw new CsvParseError("emptyFile", "File rỗng");

  const delimiter = detectDelimiter(lines[0]);
  if (!delimiter) throw new CsvParseError("invalidHeader", "Header không hợp lệ");

  const headerCols = splitLine(lines[0], delimiter);
  if (!isValidHeader(headerCols)) {
    throw new CsvParseError("invalidHeader", "Header không hợp lệ");
  }

  const rows: CsvRawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delimiter);
    rows.push({
      rowNumber: i + 1,
      dateString: cols.length > 0 ? normalizeCell(cols[0]) : null,
      shiftString: cols.length > 1 ? normalizeCell(cols[1]) : null,
      taskString: cols.length > 2 ? normalizeCell(cols[2]) : null,
      noteString: cols.length > 3 ? normalizeCell(cols[3]) : null,
    });
  }
  return rows;
}

// ---- Validation ----

export type CsvRowStatus =
  | { kind: "valid" }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string }
  | { kind: "duplicateInFile"; message: string };

export interface CsvValidatedRow {
  rowNumber: number;
  isoDate: string | null; // YYYY-MM-DD local
  shiftCode: string | null; // C1..C5 or OFF
  task: string | null;
  note: string | null;
  status: CsvRowStatus;
}

const VALID_CODES = new Set<string>(VALID_SHIFT_CODES);

export interface CsvValidationOptions {
  /** Set of existing WorkDay ISO dates (YYYY-MM-DD) for conflict detection. */
  existingWorkDayDates: Set<string>;
  /** Known task codes (uppercased); empty set skips task validation. */
  knownTaskCodes?: Set<string>;
  /**
   * Optional aliases for configured shift names, keyed by shiftAliasKey.
   * Values must be canonical shift codes (e.g. "C5").
   */
  knownShiftAliases?: Map<string, string>;
}

/** Normalizes a shift code/name for forgiving CSV matching ("Ca 5" = "Ca5"). */
export function shiftAliasKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

export function validateCsv(
  rows: CsvRawRow[],
  options: CsvValidationOptions,
): CsvValidatedRow[] {
  const knownUpper = new Set(
    Array.from(options.knownTaskCodes ?? []).map((c) => c.toUpperCase()),
  );

  interface Parsed {
    row: CsvRawRow;
    isoDate: string | null;
    shiftCode: string | null;
    task: string | null;
    note: string | null;
    error: string | null;
  }

  const parsed: Parsed[] = rows.map((row) => {
    let error: string | null = null;
    let isoDate: string | null = null;
    let shiftCode: string | null = null;

    // Date.
    if (!row.dateString) {
      error = "Thiếu ngày";
    } else {
      const d = fromDDMMYYYYLocal(row.dateString);
      if (!d) error = `Ngày không hợp lệ '${row.dateString}' (cần DD/MM/YYYY)`;
      else isoDate = toISODateLocal(d);
    }

    // Shift. Empty cells are treated as OFF so calendar templates can leave
    // days off blank. Configured display names (e.g. "Ca 5") are accepted and
    // normalized back to their stable codes (e.g. "C5").
    if (!error) {
      if (!row.shiftString) {
        shiftCode = "OFF";
      } else {
        const norm = row.shiftString.toUpperCase().trim();
        const alias = options.knownShiftAliases?.get(shiftAliasKey(row.shiftString));
        if (VALID_CODES.has(norm)) shiftCode = norm;
        else if (alias && VALID_CODES.has(alias)) shiftCode = alias;
        else error = `Ca không hợp lệ '${row.shiftString}'`;
      }
    }

    // Task (only when known codes are supplied).
    if (!error && knownUpper.size > 0 && row.taskString) {
      const codes = row.taskString
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      for (const c of codes) {
        if (!knownUpper.has(c.toUpperCase())) {
          error = `Task không hợp lệ: ${c}`;
          break;
        }
      }
    }

    return {
      row,
      isoDate,
      shiftCode,
      task: row.taskString,
      note: row.noteString,
      error,
    };
  });

  // Duplicate dates within the file.
  const dateToIndexes = new Map<string, number[]>();
  parsed.forEach((p, i) => {
    if (p.isoDate) {
      const arr = dateToIndexes.get(p.isoDate) ?? [];
      arr.push(i);
      dateToIndexes.set(p.isoDate, arr);
    }
  });
  const duplicateIndexes = new Set<number>();
  for (const [, idxs] of dateToIndexes) {
    if (idxs.length > 1) idxs.forEach((i) => duplicateIndexes.add(i));
  }

  return parsed.map((p, i) => {
    let status: CsvRowStatus;
    if (p.error) {
      status = { kind: "error", message: p.error };
    } else if (duplicateIndexes.has(i)) {
      status = {
        kind: "duplicateInFile",
        message: `Ngày trùng trong file: ${p.row.dateString}`,
      };
    } else if (p.isoDate && options.existingWorkDayDates.has(p.isoDate)) {
      status = { kind: "conflict", message: "Đã có WorkDay cho ngày này" };
    } else {
      status = { kind: "valid" };
    }
    return {
      rowNumber: p.row.rowNumber,
      isoDate: p.isoDate,
      shiftCode: p.shiftCode,
      task: p.task,
      note: p.note,
      status,
    };
  });
}

export function isOffRow(row: CsvValidatedRow): boolean {
  return (row.shiftCode ?? "").toUpperCase() === "OFF";
}

export function isImportableRow(row: CsvValidatedRow): boolean {
  return row.status.kind === "valid" && !isOffRow(row);
}

// ---- Export ----

export const CSV_HEADERS = ["Date", "Shift", "Task", "Note"] as const;

export interface ExportWorkDayInput {
  isoDate: string; // YYYY-MM-DD local
  shiftCode: string;
  task: string; // ";"-joined, sorted codes; may be ""
  note: string; // may be ""
}

function escapeField(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Builds CSV text (header + rows), sorted by date ascending. */
export function buildCsv(inputs: ExportWorkDayInput[]): string {
  const sorted = [...inputs].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const r of sorted) {
    const dateStr = toDDMMYYYYLocal(
      // isoDate is YYYY-MM-DD local; re-emit as DD/MM/YYYY
      new Date(
        parseInt(r.isoDate.slice(0, 4), 10),
        parseInt(r.isoDate.slice(5, 7), 10) - 1,
        parseInt(r.isoDate.slice(8, 10), 10),
      ),
    );
    lines.push(
      `${dateStr},${r.shiftCode},${escapeField(r.task)},${escapeField(r.note)}`,
    );
  }
  return lines.join("\n");
}
