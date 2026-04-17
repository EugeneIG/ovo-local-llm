import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Owl, OWL_SIZES, type OwlSize, type OwlState } from "../components/Owl";
import { getAppInfo, type AppInfo } from "../lib/tauri";

const STATES: OwlState[] = [
  "idle",
  "thinking",
  "typing",
  "happy",
  "sleeping",
  "surprised",
  "error",
  "struggling",
];
const SIZES: OwlSize[] = ["xs", "sm", "md", "lg", "xl"];

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function AboutPane() {
  const { t } = useTranslation();
  const [state, setState] = useState<OwlState>("idle");
  const [size, setSize] = useState<OwlSize>("lg");
  const [grabbed, setGrabbed] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void getAppInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
  }, []);

  const effectiveState = grabbed ? "struggling" : state;

  return (
    <div className="p-8 flex flex-col items-center gap-6 overflow-auto">
      <div className="text-center flex flex-col items-center">
        <button
          onMouseDown={() => setGrabbed(true)}
          onMouseUp={() => setGrabbed(false)}
          onMouseLeave={() => setGrabbed(false)}
          onTouchStart={() => setGrabbed(true)}
          onTouchEnd={() => setGrabbed(false)}
          className="cursor-grab active:cursor-grabbing select-none bg-transparent border-0 p-0"
          title="🦉"
        >
          <Owl state={effectiveState} size={size} />
        </button>
        <h1 className="text-4xl font-semibold tracking-tight mt-4">{t("app.name")}</h1>
        <p className="mt-1 text-ovo-muted">{t("app.tagline")}</p>
        {appInfo && (
          <p className="mt-1 text-xs text-ovo-accent font-mono">v{appInfo.version}</p>
        )}
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="text-xs text-ovo-muted uppercase tracking-wider">state</div>
        <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={`px-4 py-2 rounded-full text-sm transition ${
                state === s
                  ? "bg-ovo-accent text-ovo-accent-ink shadow-md"
                  : "bg-ovo-surface-solid text-ovo-muted border border-ovo-border hover:bg-ovo-nav-active"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="text-xs text-ovo-muted uppercase tracking-wider">size</div>
        <div className="flex gap-2 justify-center">
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`px-4 py-2 rounded-full text-sm transition ${
                size === s
                  ? "bg-ovo-muted text-ovo-surface-solid shadow-md"
                  : "bg-ovo-surface-solid text-ovo-muted border border-ovo-border hover:bg-ovo-nav-active"
              }`}
            >
              {s} · {OWL_SIZES[s]}px
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
