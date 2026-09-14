// ShiftFlow PWA — UI
// ui/components/syncIndicator.ts
//
// Minimal, unobtrusive cloud-sync status pill. No UI redesign — a small fixed
// badge that only appears when sync is configured, reflecting SyncService state.

import { el } from "@/ui/components/dom";
import type { SyncService, SyncState } from "@/sync/syncService";
import { isSyncConfigured } from "@/sync/syncConfig";

const LABELS: Record<SyncState, string> = {
  idle: "",
  syncing: "Đang đồng bộ…",
  synced: "Đã đồng bộ",
  offline: "Ngoại tuyến",
  conflict: "Xung đột",
};

export function mountSyncIndicator(syncService: SyncService): void {
  if (!isSyncConfigured()) return; // stays invisible until a GAS URL is set
  if (document.getElementById("sync-indicator")) return;

  const pill = el("div", {
    id: "sync-indicator",
    class: "sync-indicator",
    role: "status",
    "aria-live": "polite",
  });
  document.body.append(pill);

  const apply = (s: SyncState) => {
    const label = LABELS[s];
    pill.textContent = label;
    pill.className = `sync-indicator state-${s}` + (label ? " visible" : "");
  };
  apply(syncService.state);
  syncService.onStateChange(apply);
}
