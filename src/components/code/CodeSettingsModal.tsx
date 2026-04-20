// [START] Phase 5 — Editor + AI completion settings modal.
// Triggered from the activity-bar gear icon. Two tabs: Editor, AI. Writes
// straight into useCodeSettingsStore so changes apply live without a save
// button. Reset restores Phase 5 defaults.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings2, X } from "lucide-react";
import {
  useCodeSettingsStore,
  type AutoSaveMode,
  type BrowserPreference,
  type WordWrap,
} from "../../store/code_settings";

interface Props {
  onClose: () => void;
}

type Tab = "editor" | "ai" | "general";

export function CodeSettingsModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("editor");
  const s = useCodeSettingsStore();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[540px] max-w-[90vw] bg-ovo-surface border border-ovo-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-ovo-border">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-ovo-muted" />
            <span className="text-sm font-semibold text-ovo-text">
              {t("code.settings.title")}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface-solid transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex border-b border-ovo-border text-xs">
          <TabButton active={tab === "editor"} onClick={() => setTab("editor")}>
            {t("code.settings.tab_editor")}
          </TabButton>
          <TabButton active={tab === "ai"} onClick={() => setTab("ai")}>
            {t("code.settings.tab_ai")}
          </TabButton>
          <TabButton active={tab === "general"} onClick={() => setTab("general")}>
            {t("code.settings.tab_general")}
          </TabButton>
        </div>

        <div className="p-4 space-y-4 text-xs text-ovo-text max-h-[60vh] overflow-y-auto">
          {tab === "editor" && (
            <>
              <Row label={t("code.settings.font_size")}>
                <input
                  type="number"
                  min={10}
                  max={32}
                  value={s.fontSize}
                  onChange={(e) =>
                    s.set("fontSize", clampNumber(Number(e.target.value), 10, 32))
                  }
                  className="w-20 px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none focus:ring-1 focus:ring-ovo-accent"
                />
              </Row>
              <Row label={t("code.settings.tab_size")}>
                <select
                  value={s.tabSize}
                  onChange={(e) => s.set("tabSize", Number(e.target.value))}
                  className="px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none"
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                </select>
              </Row>
              <Row label={t("code.settings.word_wrap")}>
                <select
                  value={s.wordWrap}
                  onChange={(e) => s.set("wordWrap", e.target.value as WordWrap)}
                  className="px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none"
                >
                  <option value="off">{t("code.settings.wrap_off")}</option>
                  <option value="on">{t("code.settings.wrap_on")}</option>
                </select>
              </Row>
              <Row label={t("code.settings.minimap")}>
                <Toggle
                  checked={s.minimap}
                  onChange={(v) => s.set("minimap", v)}
                />
              </Row>
              <Row label={t("code.settings.line_numbers")}>
                <Toggle
                  checked={s.lineNumbers}
                  onChange={(v) => s.set("lineNumbers", v)}
                />
              </Row>
              <Row label={t("code.settings.auto_save")}>
                <select
                  value={s.autoSave}
                  onChange={(e) => s.set("autoSave", e.target.value as AutoSaveMode)}
                  className="px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none"
                >
                  <option value="off">{t("code.settings.auto_save_off")}</option>
                  <option value="afterDelay">
                    {t("code.settings.auto_save_after_delay")}
                  </option>
                  <option value="onFocusChange">
                    {t("code.settings.auto_save_focus")}
                  </option>
                </select>
              </Row>
              {s.autoSave === "afterDelay" && (
                <Row label={t("code.settings.auto_save_delay")}>
                  <input
                    type="number"
                    min={200}
                    max={10000}
                    step={100}
                    value={s.autoSaveDelay}
                    onChange={(e) =>
                      s.set(
                        "autoSaveDelay",
                        clampNumber(Number(e.target.value), 200, 10000),
                      )
                    }
                    className="w-24 px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none focus:ring-1 focus:ring-ovo-accent"
                  />
                  <span className="ml-1 text-ovo-muted">ms</span>
                </Row>
              )}
            </>
          )}

          {tab === "ai" && (
            <>
              <Row label={t("code.settings.completion_enabled")}>
                <Toggle
                  checked={s.completionEnabled}
                  onChange={(v) => s.set("completionEnabled", v)}
                />
              </Row>
              <Row label={t("code.settings.completion_delay")}>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  step={50}
                  value={s.completionDelayMs}
                  onChange={(e) =>
                    s.set(
                      "completionDelayMs",
                      clampNumber(Number(e.target.value), 50, 2000),
                    )
                  }
                  className="w-24 px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none focus:ring-1 focus:ring-ovo-accent"
                  disabled={!s.completionEnabled}
                />
                <span className="ml-1 text-ovo-muted">ms</span>
              </Row>
              <p className="text-[11px] text-ovo-muted leading-relaxed pt-2 border-t border-ovo-border/50">
                {t("code.settings.completion_hint")}
              </p>
            </>
          )}

          {tab === "general" && (
            <>
              <Row label={t("code.settings.browser_preference")}>
                <select
                  value={s.browserPreference}
                  onChange={(e) =>
                    s.set("browserPreference", e.target.value as BrowserPreference)
                  }
                  className="px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none"
                >
                  <option value="default">{t("code.settings.browser_default")}</option>
                  <option value="safari">Safari</option>
                  <option value="chrome">Google Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="arc">Arc</option>
                  <option value="edge">Microsoft Edge</option>
                  <option value="custom">{t("code.settings.browser_custom")}</option>
                </select>
              </Row>
              {s.browserPreference === "custom" && (
                <Row label={t("code.settings.browser_custom_app")}>
                  <input
                    type="text"
                    value={s.browserCustomApp}
                    onChange={(e) => s.set("browserCustomApp", e.target.value)}
                    placeholder="e.g. Vivaldi"
                    className="w-48 px-2 py-1 rounded bg-ovo-bg border border-ovo-border focus:outline-none focus:ring-1 focus:ring-ovo-accent"
                  />
                </Row>
              )}
              <p className="text-[11px] text-ovo-muted leading-relaxed pt-2 border-t border-ovo-border/50">
                {t("code.settings.browser_hint")}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-ovo-border bg-ovo-bg/40">
          <button
            type="button"
            onClick={() => s.reset()}
            className="text-xs text-ovo-muted hover:text-ovo-text transition"
          >
            {t("code.settings.reset")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1 rounded bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition"
          >
            {t("code.settings.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function clampNumber(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 transition border-b-2 ${
        active
          ? "border-ovo-accent text-ovo-text"
          : "border-transparent text-ovo-muted hover:text-ovo-text"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ovo-muted flex-1">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
        checked ? "bg-ovo-accent" : "bg-ovo-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
// [END] Phase 5
