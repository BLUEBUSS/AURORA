import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LockKeyhole } from "lucide-react";
import "../../styles/composer-menu.css";

export interface SelectionOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface SelectionMenuProps {
  label: string;
  value: string;
  options: readonly SelectionOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  fallbackLabel?: string;
  icon?: ReactNode;
  width?: number;
}

const supportsPopover =
  typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

export function SelectionMenu({
  label,
  value,
  options,
  onChange,
  disabled = false,
  disabledReason,
  fallbackLabel,
  icon,
  width = 300,
}: SelectionMenuProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openingIndex = useRef(0);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label || fallbackLabel || value || label;
  const unavailable = disabled || options.length === 0;

  const close = useCallback((restoreFocus = true) => {
    if (supportsPopover && menu.current?.matches(":popover-open")) menu.current.hidePopover();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  const position = useCallback(() => {
    const anchor = trigger.current;
    const panel = menu.current;
    if (!anchor || !panel) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const gutter = 10;
    const gap = 8;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = Math.max(1, Math.min(width, viewportWidth - gutter * 2));
    const above = Math.max(0, rect.top - viewportTop - gap - gutter);
    const below = Math.max(0, viewportTop + viewportHeight - rect.bottom - gap - gutter);
    // Prefer opening above the composer, but flip when the upper space is limited.
    const upwards = above >= 210 || above >= below;
    const availableHeight = Math.max(
      1,
      Math.min(360, upwards ? above : below, viewportHeight - gutter * 2),
    );
    panel.style.width = `${panelWidth}px`;
    panel.style.maxHeight = `${availableHeight}px`;
    panel.dataset.placement = upwards ? "top" : "bottom";
    const height = Math.min(panel.scrollHeight + 2, availableHeight);
    const left = Math.max(
      viewportLeft + gutter,
      Math.min(rect.left, viewportLeft + viewportWidth - gutter - panelWidth),
    );
    const desiredTop = upwards ? rect.top - gap - height : rect.bottom + gap;
    const top = Math.max(
      viewportTop + gutter,
      Math.min(desiredTop, viewportTop + viewportHeight - gutter - height),
    );
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }, [width]);

  useEffect(() => {
    if (unavailable && open) close(false);
  }, [unavailable, open, close]);

  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const panel = menu.current;
    if (supportsPopover) {
      // React 18's DOM typings predate the native popover attribute.
      panel.setAttribute("popover", "auto");
      panel.showPopover();
    }
    position();
    optionRefs.current[openingIndex.current]?.focus({ preventScroll: true });
    optionRefs.current[openingIndex.current]?.scrollIntoView({ block: "nearest" });

    function outside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || panel.contains(target) || trigger.current?.contains(target))
        return;
      // Respect a clicked control's focus. Clicking the backdrop returns to the trigger.
      const interactive =
        target instanceof Element &&
        target.closest("button, a[href], input, select, textarea, [tabindex]");
      close(!interactive);
    }
    function syncNativeClose() {
      if (supportsPopover && !panel.matches(":popover-open")) setOpen(false);
    }
    document.addEventListener("pointerdown", outside, true);
    panel.addEventListener("toggle", syncNativeClose);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(position) : null;
    if (trigger.current) {
      observer?.observe(trigger.current);
      const composer = trigger.current.closest(".composer");
      if (composer) observer?.observe(composer);
    }
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      panel.removeEventListener("toggle", syncNativeClose);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      observer?.disconnect();
    };
  }, [open, position, close]);

  function openMenu(edge?: "first" | "last") {
    if (unavailable) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    openingIndex.current =
      edge === "first" ? 0 : edge === "last" ? options.length - 1 : Math.max(0, selectedIndex);
    setActiveIndex(openingIndex.current);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || unavailable) return;
    onChange(option.value);
    close();
  }

  function triggerKeys(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(event.key === "Home" ? "first" : event.key === "End" ? "last" : undefined);
  }

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      close();
      event.stopPropagation();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") return close();
    if (event.key === "Enter" || event.key === " ") return choose(activeIndex);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus({ preventScroll: true });
    optionRefs.current[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="selection-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-describedby={`${id}-value`}
        title={disabledReason || `${label}：${selectedLabel}`}
        disabled={unavailable}
        onKeyDown={triggerKeys}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (open) close();
          else openMenu();
        }}
      >
        <span className="selection-trigger-icon" aria-hidden="true">
          {selected?.icon || icon}
        </span>
        <span className="selection-trigger-label">{selectedLabel}</span>
        {disabled && disabledReason ? (
          <LockKeyhole size={11} aria-hidden="true" />
        ) : (
          <ChevronDown size={12} className="selection-chevron" aria-hidden="true" />
        )}
      </button>
      <span id={`${id}-value`} className="selection-sr-only">
        {selectedLabel}
        {disabledReason ? `。${disabledReason}` : ""}
      </span>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-listbox`}
            className="selection-menu"
            role="listbox"
            aria-label={`${label}选项`}
            onKeyDown={menuKeys}
          >
            <div className="selection-menu-heading" aria-hidden="true">
              {label}
            </div>
            {options.map((option, index) => (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                className="selection-option"
                aria-selected={option.value === value}
                aria-labelledby={`${id}-option-${index}`}
                aria-describedby={option.description ? `${id}-description-${index}` : undefined}
                tabIndex={activeIndex === index ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  choose(index);
                }}
              >
                {option.icon && (
                  <span className="selection-option-icon" aria-hidden="true">
                    {option.icon}
                  </span>
                )}
                <span className="selection-option-copy">
                  <span id={`${id}-option-${index}`} className="selection-option-title">
                    {option.label}
                  </span>
                  {option.description && (
                    <span
                      id={`${id}-description-${index}`}
                      className="selection-option-description"
                    >
                      {option.description}
                    </span>
                  )}
                </span>
                <span className="selection-option-check" aria-hidden="true">
                  {option.value === value && <Check size={16} />}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
