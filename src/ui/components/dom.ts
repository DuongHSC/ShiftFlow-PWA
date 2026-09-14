// ShiftFlow PWA — UI
// ui/components/dom.ts
//
// Minimal DOM helpers (no framework). Business logic never lives here.

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (k === "html") node.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "dataset" && typeof v === "object") {
      Object.assign(node.dataset, v as Record<string, string>);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function mount(root: HTMLElement, ...children: Child[]): void {
  clear(root);
  for (const c of children) {
    if (c == null || c === false) continue;
    root.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

let toastTimer: number | undefined;
export function toast(message: string): void {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = el("div", { class: "toast", text: message });
  document.body.append(t);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2200);
}
