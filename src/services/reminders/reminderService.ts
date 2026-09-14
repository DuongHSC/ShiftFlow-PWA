// ShiftFlow PWA — Services
// services/reminders/reminderService.ts
//
// M1: persists the reminder PREFERENCE per WorkDay and computes fire dates.
// It does NOT deliver notifications (Web Push / scheduled notifications are
// out of M1 scope, and background delivery is unavailable on iOS Safari).
//
// Timing is derived strictly from WorkDay.resolvedStartDateTime + offset.

import type {
  ReminderConfiguration,
  ReminderOffset,
  WorkDay,
} from "@/domain/models/models";
import { ReminderRepository } from "@/storage/repositories/repositories";
import { nowISO } from "@/domain/resolver/datetime";
import { reminderFireDate } from "@/domain/resolver/reminderTiming";
import { newId } from "@/services/id";
import type { EntityChangeSink } from "@/sync/changeSink";

export class ReminderService {
  constructor(
    private repo: ReminderRepository,
    private changes?: EntityChangeSink,
  ) {}

  forWorkDay(workDayID: string): Promise<ReminderConfiguration | undefined> {
    return this.repo.forWorkDay(workDayID);
  }

  /** Enables/updates a reminder preference for a WorkDay. */
  async setReminder(
    workDayID: string,
    offset: ReminderOffset,
    isEnabled: boolean,
  ): Promise<ReminderConfiguration> {
    const existing = await this.repo.forWorkDay(workDayID);
    const now = nowISO();
    const config: ReminderConfiguration = existing
      ? { ...existing, offset, isEnabled, modifiedAt: now }
      : {
          id: newId(),
          workDayID,
          offset,
          isEnabled,
          createdAt: now,
          modifiedAt: now,
        };
    await this.repo.put(config);
    await this.changes?.record({
      entityType: "ReminderConfiguration",
      entityId: config.id,
      operation: existing ? "UPDATE" : "CREATE",
      payload: { ...config },
    });
    return config;
  }

  async clearReminder(workDayID: string): Promise<void> {
    const existing = await this.repo.forWorkDay(workDayID);
    await this.repo.deleteForWorkDay(workDayID);
    if (existing) {
      await this.changes?.record({
        entityType: "ReminderConfiguration",
        entityId: existing.id,
        operation: "DELETE",
        payload: null,
      });
    }
  }

  /** Computes the fire date for a WorkDay's enabled reminder, or null. */
  fireDate(workDay: WorkDay, config: ReminderConfiguration): Date | null {
    if (!config.isEnabled) return null;
    return reminderFireDate(workDay.resolvedStartDateTime, config.offset);
  }
}
