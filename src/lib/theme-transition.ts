import { flushSync } from "react-dom";
import { useWorkspace } from "../state";
import type { Theme } from "../types";

let active: ViewTransition | null = null;
let revision = 0;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
export function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : theme;
}
export function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#111111" : "#ffffff");
}
/** Reveal the next palette from the clicked control, without remounting page content. */
export function changeTheme(theme: Theme, origin?: HTMLElement) {
  const root = document.documentElement;
  const next = resolveTheme(theme);
  const token = ++revision;
  active?.skipTransition();
  active = null;
  clearTimeout(fallbackTimer);
  const commit = () => {
    if (token !== revision) return;
    flushSync(() => useWorkspace.getState().setTheme(theme));
    applyTheme(next);
  };
  const clear = () => {
    if (token === revision) {
      delete root.dataset.themeTransition;
      active = null;
    }
  };
  if (
    root.dataset.theme === next ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    clear();
    commit();
    return;
  }
  if (typeof document.startViewTransition !== "function") {
    root.dataset.themeTransition = "fade";
    commit();
    fallbackTimer = setTimeout(clear, 280);
    return;
  }
  const bounds = origin?.getBoundingClientRect();
  const x = bounds ? bounds.left + bounds.width / 2 : window.innerWidth - 32;
  const y = bounds ? bounds.top + bounds.height / 2 : 32;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.style.setProperty("--theme-reveal-x", `${x}px`);
  root.style.setProperty("--theme-reveal-y", `${y}px`);
  root.style.setProperty("--theme-reveal-radius", `${radius}px`);
  root.dataset.themeTransition = "reveal";
  try {
    const transition = document.startViewTransition(commit);
    active = transition;
    // Skipped transitions still apply their update; revision guards prevent stale callbacks winning.
    void transition.ready.catch(() => {});
    void transition.updateCallbackDone.catch(() => {
      if (token === revision) commit();
    });
    void transition.finished.catch(() => {}).finally(clear);
  } catch {
    commit();
    clear();
  }
}
