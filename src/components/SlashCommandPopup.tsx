import { useEffect, useRef } from "react";
import type { SlashCommand } from "../lib/slashCommands";

// [START] Phase 6.4 — Slash command popup.
// Presentation-only. Parent owns the filtered list and selected index so
// keyboard navigation can be driven from the textarea onKeyDown.

interface Props {
  items: SlashCommand[];
  index: number;
  onHover: (index: number) => void;
  onSelect: (item: SlashCommand) => void;
}

export function SlashCommandPopup({ items, index, onHover, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      className="absolute left-0 right-0 bottom-full mb-2 mx-auto max-w-md z-30 bg-ovo-surface-solid border border-ovo-border rounded-lg shadow-xl overflow-y-auto max-h-72"
    >
      {items.map((cmd, i) => {
        const active = i === index;
        return (
          <button
            key={cmd.id}
            type="button"
            role="option"
            data-idx={i}
            aria-selected={active}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              // mousedown so we run before the textarea blur fires
              e.preventDefault();
              onSelect(cmd);
            }}
            className={`w-full text-left px-3 py-2 flex items-start gap-2 text-xs transition ${
              active
                ? "bg-ovo-nav-active text-ovo-text"
                : "text-ovo-muted hover:bg-ovo-bg hover:text-ovo-text"
            }`}
          >
            <span className="w-5 shrink-0 text-center pt-0.5" aria-hidden>
              {cmd.emoji ?? "·"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium">{cmd.name}</span>
                {cmd.placeholder && (
                  <span className="text-[9px] uppercase tracking-wider text-amber-400/80">
                    soon
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ovo-muted/80 mt-0.5 truncate">
                {cmd.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
// [END]
