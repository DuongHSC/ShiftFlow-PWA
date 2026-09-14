// ShiftFlow PWA — UI
// ui/navigation/router.ts
//
// Tiny screen router + bottom navigation. Screens are async render functions
// that return a DOM node for the current view. State lives in IndexedDB via
// services; screens re-fetch on activation.
//
// Bottom navigation has 3 primary tabs: Tổng quan (home) · Lịch · Cài đặt.
// The legacy Today screen remains reachable via navigate()/#today but is not a
// bottom-nav entry. (The old 3-Days screen was removed — Overview now shows the
// next 3 days directly.)

import { el, mount } from "@/ui/components/dom";

export type ScreenId = "upcoming" | "calendar" | "settings" | "today";

export interface ScreenContext {
  navigate: (id: ScreenId) => void;
  /** Re-render the current screen (after a data change). */
  refresh: () => void;
}

export type ScreenRenderer = (ctx: ScreenContext) => Promise<HTMLElement>;

interface NavDef {
  id: ScreenId;
  label: string;
  icon: string;
}

// Only these three appear in the bottom navigation.
const NAV: NavDef[] = [
  { id: "upcoming", label: "Tổng quan", icon: "\uD83C\uDFE0" }, // 🏠
  { id: "calendar", label: "Lịch", icon: "\uD83D\uDCC5" }, // 📅
  { id: "settings", label: "Cài đặt", icon: "\u2699\uFE0F" }, // ⚙️
];

/** Which bottom-nav tab is highlighted for a given (possibly non-nav) screen. */
function navHighlightFor(id: ScreenId): ScreenId {
  if (id === "today") return "upcoming";
  return id;
}

export class Router {
  private current: ScreenId = "upcoming";

  constructor(
    private root: HTMLElement,
    private screens: Record<ScreenId, ScreenRenderer>,
    /**
     * Optional per-screen hooks fired on navigate() (a fresh entry to a screen,
     * e.g. a bottom-tab tap) but NOT on refresh(). Used to reset a screen's
     * internal sub-view when the user re-enters it.
     */
    private onEnter: Partial<Record<ScreenId, () => void>> = {},
  ) {}

  async start(initial: ScreenId = "upcoming"): Promise<void> {
    await this.navigate(initial);
  }

  navigate = async (id: ScreenId): Promise<void> => {
    this.current = id;
    this.onEnter[id]?.();
    await this.render();
  };

  refresh = async (): Promise<void> => {
    await this.render();
  };

  private async render(): Promise<void> {
    const ctx: ScreenContext = {
      navigate: (id) => void this.navigate(id),
      refresh: () => void this.refresh(),
    };
    const content = await this.screens[this.current](ctx);
    mount(this.root, content, this.buildNav());
  }

  private buildNav(): HTMLElement {
    const active = navHighlightFor(this.current);
    return el(
      "nav",
      { class: "bottom-nav", role: "tablist", "aria-label": "Điều hướng chính" },
      NAV.map((n) =>
        el(
          "button",
          {
            class: `nav-item ${n.id === active ? "active" : ""}`,
            role: "tab",
            "aria-selected": n.id === active ? "true" : "false",
            "aria-label": n.label,
            onClick: () => void this.navigate(n.id),
          },
          [
            el("span", { class: "icon", "aria-hidden": "true", text: n.icon }),
            el("span", { text: n.label }),
          ],
        ),
      ),
    );
  }
}
