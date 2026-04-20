// [START] Phase 8.4 — Slash-key command palette for the code agent.
// Triggered by the `/` button in the composer toolbar (and later by typing
// `/` at the start of an empty textarea). Mirrors Claude Code's action
// palette: filter input on top, grouped section labels, each row is a
// label + optional right-hand value + optional shortcut. Full keyboard
// navigation (↑↓ Enter Esc) plus arbitrary actions wired by the caller —
// this component stays pure UI.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface SlashAction {
  id: string;
  section: string;
  label: string;
  hint?: string; // right-hand muted hint (e.g. current model name)
  shortcut?: string;
  icon?: ReactNode;
  keywords?: string[]; // additional filter terms
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}

interface SlashPaletteProps {
  open: boolean;
  actions: SlashAction[];
  placeholder?: string;
  onClose: () => void;
}

export function SlashPalette({
  open,
  actions,
  placeholder = "Filter actions...",
  onClose,
}: SlashPaletteProps) {
  const [filter, setFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset filter & selection each time the palette reopens.
  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedIdx(0);
      // Focus after a tick so the previous focus owner doesn't steal it.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = [a.label, a.hint ?? "", a.section, ...(a.keywords ?? [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [actions, filter]);

  // Group flat filtered list by section while preserving order.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SlashAction[]>();
    for (const a of filtered) {
      if (!map.has(a.section)) {
        map.set(a.section, []);
        order.push(a.section);
      }
      map.get(a.section)!.push(a);
    }
    return order.map((s) => ({ section: s, items: map.get(s)! }));
  }, [filtered]);

  // Flat list for keyboard nav — skip disabled rows.
  const flatSelectable = useMemo(() => filtered.filter((a) => !a.disabled), [filtered]);
  const activeAction = flatSelectable[Math.min(selectedIdx, flatSelectable.length - 1)];

  // Clamp selection when filter shrinks the list.
  useEffect(() => {
    if (selectedIdx >= flatSelectable.length) setSelectedIdx(0);
  }, [flatSelectable.length, selectedIdx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, flatSelectable.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && activeAction) {
        e.preventDefault();
        if (!activeAction.disabled) {
          activeAction.onSelect();
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, flatSelectable, activeAction, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 bg-black/40 flex items-end justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-ovo-surface-solid border border-ovo-border shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        <div className="px-3 py-2 border-b border-ovo-border">
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={placeholder}
            className="w-full text-sm px-2 py-1 bg-transparent text-ovo-text placeholder:text-ovo-muted focus:outline-none"
          />
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {grouped.length === 0 ? (
            <div className="px-3 py-4 text-xs text-ovo-muted text-center">
              No matching actions
            </div>
          ) : (
            grouped.map(({ section, items }) => (
              <div key={section} className="py-1">
                <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-ovo-muted">
                  {section}
                </div>
                {items.map((a) => {
                  const isActive = activeAction?.id === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={a.disabled}
                      onMouseEnter={() => {
                        const idx = flatSelectable.findIndex((x) => x.id === a.id);
                        if (idx >= 0) setSelectedIdx(idx);
                      }}
                      onClick={() => {
                        if (a.disabled) return;
                        a.onSelect();
                        onClose();
                      }}
                      className={[
                        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
                        a.disabled
                          ? "opacity-40 cursor-not-allowed"
                          : isActive
                            ? "bg-ovo-accent/15 text-ovo-text"
                            : "hover:bg-ovo-surface/60 text-ovo-text",
                        a.destructive ? "text-rose-400" : "",
                      ].join(" ")}
                    >
                      {a.icon ? (
                        <span className="w-4 h-4 flex items-center justify-center shrink-0">
                          {a.icon}
                        </span>
                      ) : (
                        <span className="w-4 h-4 shrink-0" />
                      )}
                      <span className="flex-1 truncate">{a.label}</span>
                      {a.hint && (
                        <span className="text-ovo-muted text-[11px] shrink-0 truncate max-w-[180px]">
                          {a.hint}
                        </span>
                      )}
                      {a.shortcut && (
                        <span className="text-ovo-muted text-[10px] shrink-0">
                          {a.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
// [END]
