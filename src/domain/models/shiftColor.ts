// ShiftFlow PWA — Domain (presentation-support)
// domain/models/shiftColor.ts
//
// Maps a shift's palette color to a concrete hex value, with a deterministic
// fallback when a ShiftDefinition has no color (older records or dynamically
// added shifts like C6/C7). This contains NO business logic and NO C1..C5
// hard-coding — color is driven by the ShiftDefinition.color field, and any
// fallback is derived from the shift's stable identity.

import type { ShiftColor, ShiftDefinition } from "./models";
import { SHIFT_COLORS } from "./models";

/** Palette key -> accessible hex (paired with the shift CODE text, never color-only). */
const PALETTE: Record<ShiftColor, string> = {
  blue: "#3b82f6",
  green: "#16a34a",
  orange: "#f97316",
  purple: "#8b5cf6",
  red: "#e5484d",
  teal: "#14b8a6",
  pink: "#ec4899",
  indigo: "#4f46e5",
};

/** Neutral color used for OFF / no shift. */
export const OFF_COLOR = "#9aa0a6";

/** Hex for a palette key. */
export function paletteHex(color: ShiftColor): string {
  return PALETTE[color];
}

/** All palette entries (key + hex), for color pickers. */
export function paletteEntries(): { key: ShiftColor; hex: string }[] {
  return SHIFT_COLORS.map((key) => ({ key, hex: PALETTE[key] }));
}

/** Stable, deterministic fallback color from a shift's id/code (no C1..C5 assumptions). */
export function fallbackColorFor(idOrCode: string): ShiftColor {
  let hash = 0;
  for (let i = 0; i < idOrCode.length; i++) {
    hash = (hash * 31 + idOrCode.charCodeAt(i)) >>> 0;
  }
  return SHIFT_COLORS[hash % SHIFT_COLORS.length];
}

/** Resolves the display hex for a ShiftDefinition (uses color or a stable fallback). */
export function shiftDefinitionHex(shift: ShiftDefinition): string {
  const key = shift.color ?? fallbackColorFor(shift.code || shift.id);
  return PALETTE[key];
}
