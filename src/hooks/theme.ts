import { useEffect, useLayoutEffect, useState } from "react";
import { useWorkspace } from "../state";
import { applyTheme } from "../lib";
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const change = () => setMatches(m.matches);
    change();
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, [query]);
  return matches;
}
export function useTheme() {
  const theme = useWorkspace((s) => s.theme);
  const dark = useMedia("(prefers-color-scheme: dark)");
  const resolved = theme === "system" ? (dark ? "dark" : "light") : theme;
  useLayoutEffect(() => applyTheme(resolved), [resolved]);
  return resolved;
}
