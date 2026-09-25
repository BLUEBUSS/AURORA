import {
  useState,
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { readStorage, writeStorage } from "../state/storage";
type Sizes = { left: number; right: number };
const defaults = { left: 216, right: 288 };
export function clampPanel(value: number, other: number, width: number, side: "left" | "right") {
  const min = side === "left" ? 184 : 240,
    max = side === "left" ? 360 : 460;
  return Math.max(min, Math.min(max, width - other - 576, value));
}
export function usePanelLayout(leftOpen: boolean, rightOpen: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [sizes, setSizes] = useState<Sizes>(() => {
    const stored = readStorage("aurora-panels", defaults);
    return {
      left: Number.isFinite(stored.left) ? stored.left : 216,
      right: Number.isFinite(stored.right) ? stored.right : 288,
    };
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ side: "left" | "right"; x: number; start: number } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const left = leftOpen
    ? clampPanel(sizes.left, rightOpen ? Math.min(sizes.right, 288) : 0, width, "left")
    : 0;
  const right = rightOpen ? clampPanel(sizes.right, left, width, "right") : 0;
  useEffect(() => {
    writeStorage("aurora-panels", sizes);
  }, [sizes]);
  useEffect(
    () => () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [],
  );
  function update(side: "left" | "right", value: number) {
    setSizes((s) => ({
      ...s,
      [side]: clampPanel(value, side === "left" ? right : left, width, side),
    }));
  }
  function onPointerDown(side: "left" | "right", e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { side, x: e.clientX, start: side === "left" ? left : right };
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (d) update(d.side, d.start + (e.clientX - d.x) * (d.side === "left" ? 1 : -1));
  }
  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }
  function onKeyDown(side: "left" | "right", e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Home") {
      e.preventDefault();
      update(side, defaults[side]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta =
        (e.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1) * (e.shiftKey ? 32 : 8);
      update(side, (side === "left" ? left : right) + delta);
    }
  }
  const style = {
    "--left-width": `${left}px`,
    "--right-width": `${right}px`,
    "--left-grip": leftOpen ? "8px" : "0px",
    "--right-grip": rightOpen ? "8px" : "0px",
  } as CSSProperties;
  return {
    ref,
    style,
    left,
    right,
    dragging,
    reset: () => setSizes(defaults),
    grip: (side: "left" | "right") => ({
      role: "separator",
      tabIndex: 0,
      "aria-label": side === "left" ? "调整左侧导航宽度" : "调整右侧资料宽度",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": side === "left" ? 184 : 240,
      "aria-valuemax": side === "left" ? 360 : 460,
      "aria-valuenow": side === "left" ? left : right,
      onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => onPointerDown(side, e),
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: onPointerUp,
      onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => onKeyDown(side, e),
      onDoubleClick: () => update(side, defaults[side]),
    }),
  };
}
