// ShiftFlow PWA — UI
// ui/screens/settingsScreen.ts
//
// Settings home + sub-screens:
//   - Cấu hình ca: COMPACT list of shifts (rendered from shiftDefinitions, no
//     C1..C5 hard-coding) → shift editor (times + color) and "+ Thêm ca".
//   - Quản lý công việc: compact task list → task editor + add.
//   - Nhắc nhở / Giao diện: disabled "Sắp có" (no fake functionality).
//   - Quản lý dữ liệu: opens Data Management (CSV/JSON export + import).
//   - Giới thiệu.
// UI only — consumes existing services (adds ShiftConfigurationService.createShift).

import { app } from "@/services/appContainer";
import { el, toast } from "@/ui/components/dom";
import type { ScreenContext } from "@/ui/navigation/router";
import { renderDataManagement } from "./dataManagementScreen";
import { paletteEntries, shiftDefinitionHex } from "@/domain/models/shiftColor";
import type { ShiftColor } from "@/domain/models/models";
import {
  getThemeMode,
  setThemeMode,
  type ThemeMode,
} from "@/services/theme/themeService";

type SettingsView =
  | "root"
  | "data"
  | "shifts"
  | "shiftEditor"
  | "tasks"
  | "taskEditor"
  | "appearance";

let view: SettingsView = "root";
let editingShiftId: string | null = null; // null in editor = "add new"
let editingTaskId: string | null = null;

/**
 * Resets Settings to its ROOT view. Called by the router when the user taps the
 * "Cài đặt" bottom tab, so entering Settings never lands on a stale sub-screen
 * (e.g. Dữ liệu) after visiting another tab. Sub-navigation within Settings
 * uses refresh() and therefore preserves the sub-view.
 */
export function resetSettingsView(): void {
  view = "root";
  editingShiftId = null;
  editingTaskId = null;
}

export async function renderSettings(ctx: ScreenContext): Promise<HTMLElement> {
  switch (view) {
    case "data":
      return renderDataManagement({
        back: () => go(ctx, "root"),
        refresh: ctx.refresh,
      });
    case "shifts":
      return renderShiftList(ctx);
    case "shiftEditor":
      return renderShiftEditor(ctx);
    case "tasks":
      return renderTaskList(ctx);
    case "taskEditor":
      return renderTaskEditor(ctx);
    case "appearance":
      return renderAppearance(ctx);
    default:
      return renderRoot(ctx);
  }
}

function go(ctx: ScreenContext, v: SettingsView): void {
  view = v;
  ctx.refresh();
}

// ---- Root ----

function renderRoot(ctx: ScreenContext): HTMLElement {
  const row = (
    icon: string,
    title: string,
    subtitle: string,
    onClick?: () => void,
    enabled = true,
  ) =>
    el(
      "div",
      {
        class: `list-row${enabled ? "" : " disabled"}`,
        role: "button",
        "aria-disabled": enabled ? "false" : "true",
        onClick: enabled ? onClick : undefined,
      },
      [
        el("div", { class: "row", style: "gap:12px;justify-content:flex-start" }, [
          el("span", { class: "list-icon", "aria-hidden": "true", text: icon }),
          el("div", { class: "stack" }, [
            el("div", { style: "font-weight:600", text: title }),
            el("div", { class: "tiny", text: subtitle }),
          ]),
        ]),
        enabled
          ? el("span", { class: "chev", text: "›" })
          : el("span", { class: "badge-soon", text: "Sắp có" }),
      ],
    );

  return el("div", { class: "screen" }, [
    el("div", { class: "app-title", text: "ShiftFlow" }),
    el("h1", { class: "screen-title", text: "Cài đặt" }),

    el("div", { class: "section-label", style: "margin-top:8px", text: "Cài đặt" }),
    el("div", { class: "list-group" }, [
      row("\u2699", "Cấu hình ca làm việc", "Quản lý các ca và quy tắc", () => go(ctx, "shifts")),
      row("\u2611", "Quản lý Task", "Thêm, bật/tắt và xóa Task", () => go(ctx, "tasks")),
      row("\uD83D\uDD14", "Nhắc nhở", "Thiết lập thời gian nhắc", undefined, false),
      row("\uD83C\uDFA8", "Giao diện", "Sáng / Tối / Tự động", () => go(ctx, "appearance")),
    ]),

    el("div", { class: "section-label", text: "Quản lý dữ liệu" }),
    el("div", { class: "list-group" }, [
      row("\uD83D\uDCBE", "Dữ liệu", "Sao lưu, khôi phục (JSON / CSV)", () => go(ctx, "data")),
    ]),

    el("div", { class: "section-label", text: "Thông tin" }),
    el("div", { class: "list-group" }, [
      row("\u2139", "Giới thiệu", "Phiên bản 0.1.0 · Local-first", () =>
        toast("ShiftFlow PWA 0.1.0 · Local-first"),
      ),
    ]),
  ]);
}

function backBar(ctx: ScreenContext, label: string, to: SettingsView): HTMLElement {
  return el("div", { class: "topbar" }, [
    el("button", { class: "btn ghost back", text: label, onClick: () => go(ctx, to) }),
  ]);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function hhmm(h: number, m: number): string {
  return `${pad(h)}:${pad(m)}`;
}

// ---- Shift list (compact) ----

async function renderShiftList(ctx: ScreenContext): Promise<HTMLElement> {
  const shifts = (await app.configService.allShifts()).sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  const rows = shifts.map((s) =>
    el(
      "div",
      {
        class: "list-row",
        role: "button",
        onClick: () => {
          editingShiftId = s.id;
          go(ctx, "shiftEditor");
        },
      },
      [
        el("div", { class: "row", style: "gap:12px;justify-content:flex-start" }, [
          el("span", {
            class: "swatch",
            "aria-hidden": "true",
            style: `background:${shiftDefinitionHex(s)}`,
          }),
          el("div", { class: "stack" }, [
            el("div", {
              style: "font-weight:700",
              text: s.name || s.code,
            }),
            el("div", {
              class: "tiny",
              text: `${s.isActive ? "Đang bật" : "Đã ẩn"} · Nghỉ ${hhmm(s.breakStartHour, s.breakStartMinute)}–${hhmm(s.breakEndHour, s.breakEndMinute)}`,
            }),
          ]),
        ]),
        el("div", { class: "row", style: "gap:10px" }, [
          el("span", { style: "font-weight:600", text: `${hhmm(s.startHour, s.startMinute)}–${hhmm(s.endHour, s.endMinute)}` }),
          el("span", { class: "chev", text: "›" }),
        ]),
      ],
    ),
  );

  return el("div", { class: "screen" }, [
    backBar(ctx, "‹ Cài đặt", "root"),
    el("h1", { class: "screen-title", text: "Cấu hình ca" }),
    el("div", { class: "screen-subtitle", text: "Sửa giờ mặc định. Không ảnh hưởng WorkDay đã lưu." }),
    el("div", { class: "list-group" }, rows.length ? rows : [el("div", { class: "empty-state", text: "Chưa có ca." })]),
    el("button", {
      class: "btn primary block",
      text: "+ Thêm ca",
      onClick: () => {
        editingShiftId = null;
        go(ctx, "shiftEditor");
      },
    }),
  ]);
}

// ---- Shift editor (times + color; add or edit) ----

async function renderShiftEditor(ctx: ScreenContext): Promise<HTMLElement> {
  const shifts = await app.configService.allShifts();
  const existing = editingShiftId
    ? shifts.find((s) => s.id === editingShiftId)
    : undefined;

  let selectedColor: ShiftColor =
    existing?.color ?? "blue";

  // Existing shifts keep a stable code for WorkDay lookup; the display name is
  // editable and can differ from the code.
  const nameInput = el("input", {
    type: "text",
    value: existing?.name ?? "",
    placeholder: "Tên ca (vd: C6, Ca đêm)",
  });
  const start = el("input", { type: "time", value: existing ? hhmm(existing.startHour, existing.startMinute) : "08:00" });
  const end = el("input", { type: "time", value: existing ? hhmm(existing.endHour, existing.endMinute) : "17:00" });
  const bStart = el("input", { type: "time", value: existing ? hhmm(existing.breakStartHour, existing.breakStartMinute) : "12:00" });
  const bEnd = el("input", { type: "time", value: existing ? hhmm(existing.breakEndHour, existing.breakEndMinute) : "13:00" });

  const swatches = el(
    "div",
    { class: "swatch-row" },
    paletteEntries().map((p) =>
      el("button", {
        class: `swatch-btn${p.key === selectedColor ? " selected" : ""}`,
        "aria-label": p.key,
        "data-key": p.key,
        style: `background:${p.hex}`,
        onClick: (e: Event) => {
          selectedColor = p.key;
          const container = (e.target as HTMLElement).parentElement;
          container?.querySelectorAll(".swatch-btn").forEach((b) => b.classList.remove("selected"));
          (e.target as HTMLElement).classList.add("selected");
        },
      }),
    ),
  );

  const parse = (input: HTMLElement): [number, number] => {
    const [h, m] = (input as HTMLInputElement).value.split(":").map((x) => parseInt(x, 10));
    return [h || 0, m || 0];
  };

  const save = async () => {
    const [sh, sm] = parse(start);
    const [eh, em] = parse(end);
    const [bsh, bsm] = parse(bStart);
    const [beh, bem] = parse(bEnd);
    const nameValue = (nameInput as HTMLInputElement).value.trim();
    try {
      if (existing) {
        await app.configService.updateShift({
          ...existing,
          name: nameValue || existing.code,
          color: selectedColor,
          startHour: sh, startMinute: sm,
          endHour: eh, endMinute: em,
          breakStartHour: bsh, breakStartMinute: bsm,
          breakEndHour: beh, breakEndMinute: bem,
        });
        toast(`Đã lưu ${nameValue || existing.code}`);
      } else {
        // The single "Tên ca" field becomes the code (and display name).
        const created = await app.configService.createShift({
          code: nameValue,
          name: nameValue || undefined,
          color: selectedColor,
          startHour: sh, startMinute: sm,
          endHour: eh, endMinute: em,
          breakStartHour: bsh, breakStartMinute: bsm,
          breakEndHour: beh, breakEndMinute: bem,
        });
        toast(`Đã thêm ${created.code}`);
      }
      go(ctx, "shifts");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Lưu thất bại");
    }
  };

  const del = async () => {
    if (!existing) return;
    try {
      const result = await app.configService.deleteShift(existing.id);
      toast(
        result === "deactivated"
          ? `Đã ẩn ca ${existing.code}; lịch sử cũ vẫn được giữ`
          : `Đã xóa ca ${existing.code}`,
      );
      go(ctx, "shifts");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Xóa ca thất bại");
    }
  };

  const reactivate = async () => {
    if (!existing || existing.isActive) return;
    await app.configService.updateShift({ ...existing, isActive: true });
    toast(`Đã bật lại ca ${existing.code}`);
    go(ctx, "shifts");
  };

  return el("div", { class: "screen" }, [
    backBar(ctx, "‹ Cấu hình ca", "shifts"),
    el("h1", {
      class: "screen-title",
      text: existing ? (existing.name || existing.code) : "Thêm ca",
    }),
    el("div", { class: "card" }, [
      field("Tên ca", nameInput),
      el("label", { class: "field" }, [el("span", { text: "Màu ca" }), swatches]),
      field("Bắt đầu", start),
      field("Kết thúc", end),
      field("Nghỉ từ", bStart),
      field("Nghỉ đến", bEnd),
    ]),
    el("div", { class: "btn-row" }, [
      el("button", { class: "btn ghost block", text: "Hủy", onClick: () => go(ctx, "shifts") }),
      el("button", { class: "btn primary block", text: "Lưu", onClick: () => void save() }),
    ]),
    existing
      ? el("button", {
          class: "btn danger block",
          style: "margin-top:8px",
          text: "Xóa ca",
          onClick: () => void del(),
        })
      : null,
    existing && !existing.isActive
      ? el("button", {
          class: "btn primary block",
          style: "margin-top:8px",
          text: "Bật lại ca",
          onClick: () => void reactivate(),
        })
      : null,
  ]);
}

function field(label: string, input: HTMLElement): HTMLElement {
  return el("label", { class: "field" }, [el("span", { text: label }), input]);
}

// ---- Appearance ----

function renderAppearance(ctx: ScreenContext): HTMLElement {
  const mode = getThemeMode();
  const options: { mode: ThemeMode; title: string; subtitle: string }[] = [
    { mode: "system", title: "Tự động", subtitle: "Theo giao diện của thiết bị" },
    { mode: "light", title: "Sáng", subtitle: "Nền sáng, dễ nhìn ban ngày" },
    { mode: "dark", title: "Tối", subtitle: "Nền tối, dịu mắt ban đêm" },
  ];

  const rows = options.map((option) =>
    el(
      "div",
      {
        class: "list-row",
        role: "button",
        "aria-pressed": option.mode === mode ? "true" : "false",
        onClick: () => {
          setThemeMode(option.mode);
          toast(`Đã chọn ${option.title}`);
          ctx.refresh();
        },
      },
      [
        el("div", { class: "stack" }, [
          el("div", { style: "font-weight:700", text: option.title }),
          el("div", { class: "tiny", text: option.subtitle }),
        ]),
        el("span", {
          class: option.mode === mode ? "checkmark" : "checkmark empty",
          "aria-hidden": "true",
          text: option.mode === mode ? "✓" : "",
        }),
      ],
    ),
  );

  return el("div", { class: "screen" }, [
    backBar(ctx, "‹ Cài đặt", "root"),
    el("h1", { class: "screen-title", text: "Giao diện" }),
    el("div", { class: "screen-subtitle", text: "Chọn cách ShiftFlow hiển thị trên thiết bị này." }),
    el("div", { class: "list-group" }, rows),
  ]);
}

// ---- Task list (compact) ----

async function renderTaskList(ctx: ScreenContext): Promise<HTMLElement> {
  const tasks = await app.taskService.allTasks();

  const rows = tasks.length
    ? tasks.map((t) =>
        el("div", { class: "list-row task-settings-row" }, [
          el("div", { class: "stack" }, [
            el("div", { style: "font-weight:600", text: `${t.code} — ${t.name}` }),
            el("div", { class: "tiny", text: t.isActive ? "Đang bật" : "Đã tắt" }),
          ]),
          el("div", { class: "row task-settings-actions", style: "gap:6px" }, [
            el("button", {
              class: `btn ghost small ${t.isActive ? "" : "muted-btn"}`,
              text: t.isActive ? "Bật" : "Tắt",
              onClick: async (e: Event) => {
                (e as Event).stopPropagation();
                await app.taskService.setActive(t.id, !t.isActive);
                ctx.refresh();
              },
            }),
            el("button", {
              class: "btn danger small",
              text: "Xóa",
              onClick: async (e: Event) => {
                (e as Event).stopPropagation();
                const confirmed = window.confirm(
                  `Xóa Task "${t.code}"? Thao tác này không thể hoàn tác.`,
                );
                if (!confirmed) return;
                try {
                  const result = await app.taskService.deleteTask(t.id);
                  toast(
                    result === "deactivated"
                      ? `Đã ẩn task ${t.code}; lịch sử cũ vẫn được giữ`
                      : `Đã xóa task ${t.code}`,
                  );
                  ctx.refresh();
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Xóa task thất bại");
                }
              },
            }),
          ]),
        ]),
      )
    : [el("div", { class: "empty-state", text: "Chưa có công việc." })];

  return el("div", { class: "screen" }, [
    backBar(ctx, "‹ Cài đặt", "root"),
    el("h1", { class: "screen-title", text: "Quản lý Task" }),
    el("div", { class: "list-group" }, rows),
    el("button", {
      class: "btn primary block",
      text: "+ Thêm Task",
      onClick: () => {
        editingTaskId = null;
        go(ctx, "taskEditor");
      },
    }),
  ]);
}

async function renderTaskEditor(ctx: ScreenContext): Promise<HTMLElement> {
  void editingTaskId; // only "add" is supported here in M1
  const codeInput = el("input", { type: "text", placeholder: "Mã (vd: Ticket)" });
  const nameInput = el("input", { type: "text", placeholder: "Tên hiển thị" });

  const add = async () => {
    try {
      await app.taskService.createTask(
        (codeInput as HTMLInputElement).value,
        (nameInput as HTMLInputElement).value,
      );
      toast("Đã thêm công việc");
      go(ctx, "tasks");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Thêm thất bại");
    }
  };

  return el("div", { class: "screen" }, [
    backBar(ctx, "‹ Quản lý công việc", "tasks"),
    el("h1", { class: "screen-title", text: "Thêm Task" }),
    el("div", { class: "card" }, [field("Mã Task", codeInput), field("Tên Task", nameInput)]),
    el("div", { class: "btn-row" }, [
      el("button", { class: "btn ghost block", text: "Hủy", onClick: () => go(ctx, "tasks") }),
      el("button", { class: "btn primary block", text: "Lưu", onClick: () => void add() }),
    ]),
  ]);
}
