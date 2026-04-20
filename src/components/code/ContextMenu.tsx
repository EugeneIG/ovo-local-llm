// [START] Phase 8.4 — reusable right-click context menu.
// Shared by the file explorer, monaco editor, and chat composer. Handles
// positioning (clamped to viewport), keyboard dismissal (Esc), outside-
// click dismissal, icon + label rendering, separators, and disabled state.
// Keep this visual-only — action wiring lives in each caller.
import { useEffect, useRef, type ReactNode } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Insert a divider ABOVE this item (use for grouping). */
  separatorBefore?: boolean;
  /** Style cue: destructive actions render red. */
  destructive?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp to viewport — measure after mount and nudge if we'd clip.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nudged: { left?: string; top?: string } = {};
    if (rect.right > window.innerWidth - 4) {
      nudged.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    }
    if (rect.bottom > window.innerHeight - 4) {
      nudged.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
    }
    if (nudged.left) el.style.left = nudged.left;
    if (nudged.top) el.style.top = nudged.top;
  }, []);

  return (
    <div
      ref={ref}
      className="fixed z-[1000] min-w-[220px] bg-ovo-surface-solid border border-ovo-chip-border rounded-md shadow-xl py-1 text-xs text-ovo-text"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, i) => (
        <div key={item.id}>
          {item.separatorBefore && i > 0 && (
            <div className="my-1 border-t border-ovo-chip-border" />
          )}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose();
            }}
            className={[
              "w-full flex items-center gap-2 px-3 py-1.5 text-left transition",
              item.disabled
                ? "opacity-40 cursor-not-allowed"
                : "hover:bg-ovo-surface/60",
              item.destructive ? "text-red-400" : "",
            ].join(" ")}
          >
            {item.icon ? (
              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                {item.icon}
              </span>
            ) : (
              <span className="w-4 h-4 shrink-0" />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="text-ovo-muted text-[10px] shrink-0">
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
// [END]
