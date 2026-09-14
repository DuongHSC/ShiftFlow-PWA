import type { ShiftFlowDB } from "@/storage/db/db";
import type { ReminderOffset, WorkDayEvent } from "@/domain/models/models";
import { dateTimeOnLocalDay, fromISODateLocal } from "@/domain/resolver/datetime";
import { offsetMillis } from "@/domain/resolver/reminderTiming";

const MAX_TIMEOUT_MS = 2_147_483_647;

export interface EventReminder {
  id: string;
  title: string;
  body: string;
  fireDate: Date;
}

// Backward-compatible aliases for callers/tests from the pre-separation API.
// New reminders belong to timed WorkDayEvents, not Task assignments.
export type TaskReminder = EventReminder;

export function eventReminderFireDate(
  workDayDateISO: string,
  startTime: string,
  offset: ReminderOffset,
): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const start = dateTimeOnLocalDay(fromISODateLocal(workDayDateISO), hour, minute);
  return new Date(start.getTime() + offsetMillis(offset));
}

export const taskReminderFireDate = eventReminderFireDate;

export class NotificationScheduler {
  private timers = new Map<string, number>();

  constructor(private db: ShiftFlowDB) {}

  async start(): Promise<void> {
    if (!this.supported()) return;
    await this.reschedule();
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.supported()) return "denied";
    if (Notification.permission !== "default") return Notification.permission;
    return Notification.requestPermission();
  }

  async reschedule(): Promise<void> {
    this.clear();
    if (!this.supported() || Notification.permission !== "granted") return;
    const reminders = await this.upcomingEventReminders(new Date());
    for (const reminder of reminders) {
      const delay = reminder.fireDate.getTime() - Date.now();
      if (delay < 0 || delay > MAX_TIMEOUT_MS) continue;
      const timer = window.setTimeout(() => {
        new Notification(reminder.title, { body: reminder.body, tag: reminder.id });
        this.timers.delete(reminder.id);
      }, delay);
      this.timers.set(reminder.id, timer);
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
  }

  async upcomingEventReminders(now: Date): Promise<EventReminder[]> {
    const [workDays, events] = await Promise.all([
      this.db.workDays.toArray(),
      this.db.workDayEvents.toArray(),
    ]);
    const workDayById = new Map(workDays.map((w) => [w.id, w]));
    const out: EventReminder[] = [];

    for (const event of events) {
      const reminder = this.buildEventReminder(event);
      if (!reminder) continue;
      const workDay = workDayById.get(event.workDayID);
      if (!workDay) continue;

      const fireDate = eventReminderFireDate(
        workDay.date,
        reminder.startTime,
        reminder.offset,
      );
      if (!fireDate || fireDate <= now) continue;
      out.push({
        id: event.id,
        title: event.title,
        body: `${reminder.startTime}${reminder.endTime ? `–${reminder.endTime}` : ""}`,
        fireDate,
      });
    }

    return out.sort((a, b) => a.fireDate.getTime() - b.fireDate.getTime());
  }

  private supported(): boolean {
    return typeof window !== "undefined" && "Notification" in window;
  }

  private buildEventReminder(
    event: WorkDayEvent,
  ): { startTime: string; endTime: string; offset: ReminderOffset } | null {
    if (!event.reminderEnabled || !event.startTime) return null;
    return {
      startTime: event.startTime,
      endTime: event.endTime,
      offset: event.reminderOffset ?? "30min",
    };
  }
}
