// [START] Phase 8 — Editor tab bar
import { X } from "lucide-react";
import type { OpenTab } from "../../types/code";

interface EditorTabsProps {
  tabs: OpenTab[];
  activeTabPath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function EditorTabs({ tabs, activeTabPath, onSelect, onClose }: EditorTabsProps) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center bg-ovo-surface border-b border-ovo-border overflow-x-auto shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath;
        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => onSelect(tab.path)}
            onAuxClick={(e) => {
              // Middle-click to close
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.path);
              }
            }}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-ovo-border shrink-0 transition ${
              isActive
                ? "bg-ovo-bg text-ovo-text border-b-2 border-b-ovo-accent"
                : "bg-ovo-surface text-ovo-muted hover:text-ovo-text hover:bg-ovo-bg/50"
            }`}
            title={tab.path}
          >
            {/* Dirty indicator */}
            {tab.modified && (
              <span className="w-1.5 h-1.5 rounded-full bg-ovo-accent shrink-0" />
            )}
            <span className="truncate max-w-[120px]">{tab.name}</span>
            {/* Close button */}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.path);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-ovo-border transition"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
// [END] Phase 8
