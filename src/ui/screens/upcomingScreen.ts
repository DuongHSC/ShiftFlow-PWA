// ShiftFlow PWA — UI
// ui/screens/upcomingScreen.ts
//
// "Tổng quan" — VIEW ONLY. Shows the next THREE calendar days (today, tomorrow,
// day after) read directly from the single source of truth (WorkDay +
// WorkDayTask). Tasks shown are exactly the VISIBLE assignments — Overview has
// NO visibility preference of its own; it reflects whatever was configured in
// Calendar/Day Detail.
//
// No edit/delete/toggle here. To change anything the user goes to the Lịch tab.
// No CTA buttons: the 3 days are already shown, and Calendar is a bottom tab.

import { app } from "@/services/appContainer";
import { el } from "@/ui/components/dom";
import type { ScreenContext } from "@/ui/navigation/router";
import {
  buildShiftColorMap,
  longDate,
  shiftTitle,
  shiftBadge,
  timeFromISO,
  type ShiftColorMap,
} from "@/ui/components/format";
import { startOfLocalDay } from "@/domain/resolver/datetime";
import type { WorkDay } from "@/domain/models/models";

export async function renderUpcoming(_ctx: ScreenContext): Promise<HTMLElement> {
  const base = startOfLocalDay(new Date());
  const shifts = await app.configService.allShifts();
  const colors = buildShiftColorMap(shifts);

  // Exactly the next 3 calendar days: today, tomorrow, day after.
  const days: { heading: string; date: Date; size: "md" | "lg" }[] = [
    { heading: "Hôm nay", date: dayOffset(base, 0), size: "lg" },
    { heading: "Ngày mai", date: dayOffset(base, 1), size: "md" },
    { heading: "Ngày kia", date: dayOffset(base, 2), size: "md" },
  ];

  const blocks = await Promise.all(
    days.map((d) => dayBlock(d.heading, d.date, shifts, colors, d.size)),
  );

  return el("div", { class: "screen" }, [
    el("div", { class: "app-title", text: "ShiftFlow" }),
    el("h1", { class: "screen-title", text: "Tổng quan" }),
    el("div", { class: "screen-subtitle", text: "Lịch làm việc của bạn" }),
    ...blocks,
  ]);
}

function dayOffset(base: Date, n: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
}

async function dayBlock(
  heading: string,
  d: Date,
  shifts: Awaited<ReturnType<typeof app.configService.allShifts>>,
  colors: ShiftColorMap,
  size: "md" | "lg",
): Promise<HTMLElement> {
  const w = await app.workDayService.byDate(d);
  // Read the SAME visibility source of truth Calendar/Day Detail write to.
  const visibleTaskCodes = w
    ? (await app.taskService.visibleTasksForWorkDay(w.id)).map((t) => t.code)
    : [];
  const events = w ? await app.eventService.forWorkDay(w.id) : [];

  // Quiet date heading (not a loud uppercase overline): "Hôm nay" + date below.
  return el("div", { class: "stack", style: "gap:8px;margin-bottom:18px" }, [
    el("div", { class: "day-heading" }, [
      el("span", { class: "day-heading-label", text: heading }),
      el("span", { class: "day-heading-date", text: `· ${longDate(d)}` }),
    ]),
    shiftCard({ w, visibleTaskCodes, events, shifts, colors, size }),
  ]);
}

interface CardArgs {
  w: WorkDay | undefined;
  visibleTaskCodes: string[];
  events: { title: string; startTime: string; endTime: string }[];
  shifts: Awaited<ReturnType<typeof app.configService.allShifts>>;
  colors: ShiftColorMap;
  size: "md" | "lg";
}

function shiftCard(a: CardArgs): HTMLElement {
  const { w, visibleTaskCodes, events, shifts, colors, size } = a;
  const timeSize = size === "lg" ? "font-size:22px" : "font-size:18px";

  // Hierarchy: shift badge · time · Task · Công việc · Ghi chú. A FIXED badge column ("wd-card"
  // grid) guarantees the content column starts at the same X for every card,
  // regardless of the shift code text. Note only renders when present.
  const badgeCol = el("div", { class: "wd-badge-col" }, [
    shiftBadge(w ? w.shiftCode : "OFF", colors, { size }),
  ]);

  const content = w
      ? el("div", { class: "stack wd-content", style: "gap:10px" }, [
        el("div", { class: "shift-title", text: shiftTitle(w.shiftCode, shifts) }),
        el("div", { class: "time", style: timeSize, text: `${timeFromISO(w.resolvedStartDateTime)} – ${timeFromISO(w.resolvedEndDateTime)}` }),
        el("div", { class: "wd-info-grid" }, [
          el("div", { class: "wd-info-section wd-task-info" }, [
            el("div", { class: "wd-info-label" }, [
              el("span", { class: "wd-info-icon", text: "✓", "aria-hidden": "true" }),
              el("span", { text: "Task" }),
            ]),
            visibleTaskCodes.length
              ? el("div", { class: "chips" },
                  visibleTaskCodes.map((c) => el("span", { class: "chip readonly", text: c })))
              : el("div", { class: "wd-empty-info", text: "Chưa có task" }),
          ]),
          el("div", { class: "wd-info-section wd-event-info" }, [
            el("div", { class: "wd-info-label" }, [
              el("span", { class: "wd-info-icon", text: "◷", "aria-hidden": "true" }),
              el("span", { text: "Công việc" }),
            ]),
            events.length
              ? el("div", { class: "wd-event-list" },
                  events.map((event) =>
                    el("div", { class: "wd-event-line" }, [
                      el("span", { class: "wd-event-title", text: event.title }),
                      el("span", { class: "wd-event-time", text: `${event.startTime}–${event.endTime}` }),
                    ]),
                  ))
              : el("div", { class: "wd-empty-info", text: "Chưa có công việc" }),
          ]),
          w.note
            ? el("div", { class: "wd-info-section wd-note-info" }, [
                el("div", { class: "wd-info-label" }, [
                  el("span", { class: "wd-info-icon", text: "✎", "aria-hidden": "true" }),
                  el("span", { text: "Ghi chú" }),
                ]),
                el("div", { class: "note-line", text: w.note }),
              ])
            : null,
        ]),
      ])
    : el("div", { class: "stack wd-content", style: "gap:4px" }, [
        el("div", { class: "time", style: timeSize, text: "Nghỉ" }),
        el("div", { class: "muted", text: "Không có ca làm" }),
      ]);

  // VIEW ONLY: no click handler, no edit affordance.
  return el("div", { class: `card wd-card wd-card-${size}` }, [badgeCol, content]);
}
