import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, UserRound } from "lucide-react";
import { displayProfileName, useModelProfilesStore } from "../store/model_profiles";

// [START] Phase 6.4 — ModelProfileSelector
// Compact dropdown shown in the ChatPane header. Clicking opens a menu of
// built-in + custom profiles; selecting one writes activeId to the profile
// store, which chat.ts reads on every send to inject the profile's persona +
// user honorific + sampling overrides.

export function ModelProfileSelector() {
  const { t } = useTranslation();
  const profiles = useModelProfilesStore((s) => s.profiles);
  const activeId = useModelProfilesStore((s) => s.activeId);
  const setActive = useModelProfilesStore((s) => s.setActive);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null;
  if (!active) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("chat.profile.label")}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs transition ${
          open
            ? "bg-ovo-surface-solid border-ovo-accent text-ovo-text"
            : "bg-ovo-surface border-ovo-border text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface-solid"
        }`}
      >
        {/* [START] Phase 8 — emoji hidden in selector chrome (request).
            The profile's emoji stays in the underlying md file so custom
            personas can express themselves elsewhere, but the chat header
            and dropdown render as plain-text labels with a neutral icon. */}
        <UserRound className="w-3 h-3" aria-hidden />
        <span>{displayProfileName(active, t)}</span>
        {/* [END] */}
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-1 z-30 min-w-[200px] rounded-lg bg-ovo-surface-solid border border-ovo-border shadow-lg py-1"
        >
          {profiles.map((p) => {
            const isActive = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setActive(p.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition ${
                  isActive
                    ? "bg-ovo-nav-active text-ovo-text"
                    : "text-ovo-muted hover:bg-ovo-bg hover:text-ovo-text"
                }`}
              >
                <span className="flex-1 truncate">{displayProfileName(p, t)}</span>
                {p.builtin && (
                  <span className="text-[9px] uppercase tracking-wider text-ovo-muted/70">
                    {t("chat.profile.builtin")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
// [END]
