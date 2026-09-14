// ShiftFlow PWA — Entry Point
// src/main.ts
//
// Startup flow (local-first):
//   PWA opens -> seed IndexedDB if needed -> render UI from IndexedDB.
// No network, no remote API, no manual "Load Data" required for normal startup.

import "@/styles/styles.css";
import { app } from "@/services/appContainer";
import { Router, type ScreenId } from "@/ui/navigation/router";
import { renderUpcoming } from "@/ui/screens/upcomingScreen";
import { renderToday } from "@/ui/screens/todayScreen";
import { renderCalendar } from "@/ui/screens/calendarScreen";
import { renderSettings, resetSettingsView } from "@/ui/screens/settingsScreen";
import { el } from "@/ui/components/dom";
import { applyThemeMode } from "@/services/theme/themeService";
import { mountSyncIndicator } from "@/ui/components/syncIndicator";
import { isSyncConfigured } from "@/sync/syncConfig";

async function boot(): Promise<void> {
  applyThemeMode();

  const root = document.getElementById("app");
  if (!root) return;

  try {
    await app.bootstrap();
    await app.notificationScheduler.start();
  } catch (err) {
    root.append(
      el("div", { class: "screen" }, [
        el("h1", { class: "screen-title", text: "ShiftFlow" }),
        el("div", { class: "empty-state", text: "Không thể mở cơ sở dữ liệu cục bộ." }),
        el("div", { class: "tiny", text: err instanceof Error ? err.message : String(err) }),
      ]),
    );
    return;
  }

  const router = new Router(
    root,
    {
      upcoming: renderUpcoming,
      calendar: renderCalendar,
      settings: renderSettings,
      today: renderToday,
    },
    {
      // Tapping the "Cài đặt" tab always returns to Settings root.
      settings: resetSettingsView,
    },
  );

  const initial = (location.hash.replace("#", "") as ScreenId) || "upcoming";
  await router.start(
    ["upcoming", "calendar", "settings", "today"].includes(initial)
      ? initial
      : "upcoming",
  );

  // ---- Cloud sync (local-first, best-effort) ----
  // When the cloud applies remote changes, refresh the current screen so the
  // UI reflects the pulled data. Never blocks the UI; only active if a GAS URL
  // is configured.
  app.syncService.setOnRemoteApplied(() => void router.refresh());
  mountSyncIndicator(app.syncService);

  if (isSyncConfigured()) {
    void app.syncService.sync().catch(() => {
      /* stay local-first */
    });
    globalThis.addEventListener?.("online", () => {
      void app.syncService.sync().catch(() => {});
    });
  }
}

void boot();
