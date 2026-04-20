import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { Owl } from "../components/Owl";
import type { OwlState } from "../components/Owl";
import "./pet.css";

// [START] Phase 7 — PetApp: transparent floating pet window.
// Mounts inside the "pet" Tauri window (visible: false by default).
// State synced from main window via Tauri event bus ("owl:state").
// Drag handled by Tauri OS-native startDragging().
// Position persisted via Rust `pet_save_position` / `pet_get_position`
// (JSON under app_data_dir). We previously tried localStorage here but the
// pet window's WebView context doesn't reliably share localStorage across
// cold restarts on all macOS versions, so Rust-side JSON is authoritative.
// Size still uses localStorage — the pet window is the only reader, so a
// cold-start miss just falls back to DEFAULT_SIZE (tolerable UX).

const LS_SIZE_KEY = "ovo:pet_size";
const DEFAULT_SIZE = 320;
const SIZE_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "작게 (160)", value: 160 },
  { label: "보통 (220)", value: 220 },
  { label: "크게 (320)", value: 320 },
  { label: "매우 크게 (420)", value: 420 },
];

function readSavedSize(): number {
  try {
    const raw = localStorage.getItem(LS_SIZE_KEY);
    if (!raw) return DEFAULT_SIZE;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 80 && n <= 800 ? n : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

function saveSize(px: number): void {
  try {
    localStorage.setItem(LS_SIZE_KEY, String(px));
  } catch {
    // ignore
  }
}

async function readSavedPosition(): Promise<{ x: number; y: number } | null> {
  try {
    // Rust returns `Option<(i32, i32)>` → `null` or `[x, y]` on the wire.
    const tuple = await invoke<[number, number] | null>("pet_get_position");
    if (!tuple) return null;
    const [x, y] = tuple;
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  } catch {
    return null;
  }
}

async function savePosition(x: number, y: number): Promise<void> {
  try {
    await invoke("pet_save_position", { x, y });
  } catch {
    // storage unavailable — silent
  }
}

// [START] Ambient mood cycle configuration
const AMBIENT_MOODS: ReadonlyArray<OwlState> = ["idle", "happy", "surprised"];
const AMBIENT_CYCLE_MS = 4500;          // rotate mood every 4.5s
const SLEEP_AFTER_IDLE_MS = 5 * 60_000; // 5 min of inactivity → sleeping
// [END]

export function PetApp() {
  // [START] Layered pet mood:
  //   pressState   — "struggling" while mouse/pointer is held down
  //   chatState    — last chat-driven event (thinking, typing, happy, error…)
  //   ambientState — local rotation idle / happy / surprised, or sleeping
  // Precedence: press > chat (if recent) > ambient.
  const [pressState, setPressState] = useState<OwlState | null>(null);
  const [chatState, setChatState] = useState<OwlState | null>(null);
  const [ambientState, setAmbientState] = useState<OwlState>("idle");
  const [lastActivity, setLastActivity] = useState<number>(() => Date.now());
  const [size, setSize] = useState<number>(() => readSavedSize());

  const owlState: OwlState = pressState ?? chatState ?? ambientState;
  // [END]

  // [START] Apply size to the window whenever `size` state changes.
  useEffect(() => {
    void getCurrentWindow().setSize(new LogicalSize(size, size));
    saveSize(size);
  }, [size]);
  // [END]

  // [START] Ambient mood cycle — rotate through idle / happy / surprised
  // every AMBIENT_CYCLE_MS. Falls asleep after SLEEP_AFTER_IDLE_MS of no
  // interaction. Resets on any user activity (pointer, drag, double-click).
  useEffect(() => {
    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivity;
      if (idleFor >= SLEEP_AFTER_IDLE_MS) {
        setAmbientState("sleeping");
        return;
      }
      setAmbientState((prev) => {
        const pool = AMBIENT_MOODS.filter((m) => m !== prev);
        const next = pool[Math.floor(Math.random() * pool.length)];
        return next ?? "idle";
      });
    }, AMBIENT_CYCLE_MS);
    return () => clearInterval(interval);
  }, [lastActivity]);
  // [END]

  // [START] Context menu — native macOS popup (right-click on owl)
  async function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        ...SIZE_PRESETS.map((p) => ({
          id: `size_${p.value}`,
          text: `${p.label}${p.value === size ? "  ✓" : ""}`,
          action: () => setSize(p.value),
        })),
        { item: "Separator" },
        {
          id: "focus_main",
          text: "OVO 열기",
          action: () => {
            void invoke("focus_main_window");
          },
        },
        {
          id: "hide",
          text: "펫 숨기기",
          action: () => {
            // [START] Broadcast so the main window's pet store flips the
            // Settings toggle off — otherwise the UI claims the pet is still
            // enabled while the window has been dismissed.
            void emit("pet:disabled");
            // [END]
            void invoke("pet_hide");
          },
        },
      ],
    });
    await menu.popup();
  }
  // [END]

  // [START] Restore saved position on mount, subscribe to owl:state events
  useEffect(() => {
    const win = getCurrentWindow();

    // Restore position via Rust-managed JSON (survives cold restarts on macOS
    // where WebView localStorage can be lost for secondary windows).
    void readSavedPosition().then((saved) => {
      if (saved) {
        void win.setPosition(new PhysicalPosition(saved.x, saved.y));
      }
    });

    // [START] Chat-driven state — "thinking" and "typing" are active
    // streaming states and must persist until the main window explicitly
    // flips to "idle" (otherwise long reasoning / long responses lose the
    // animation mid-stream). Transient states (happy, error, surprised)
    // still auto-clear after 6s so the pet doesn't stick on them.
    const ACTIVE_STATES: ReadonlyArray<OwlState> = ["thinking", "typing"];
    let chatClearTimer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | undefined;
    void listen<{ state: OwlState }>("owl:state", (e) => {
      if (chatClearTimer) clearTimeout(chatClearTimer);
      const state = e.payload.state;
      if (state === "idle") {
        setChatState(null);
      } else if (ACTIVE_STATES.includes(state)) {
        setChatState(state);
      } else {
        setChatState(state);
        chatClearTimer = setTimeout(() => setChatState(null), 6000);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    // [END]

    // Subscribe to window.onMoved — Tauri 2 native window API is more
    // reliable than the global `tauri://move` event, which can miss frames
    // on some macOS builds. Debounce so rapid drags don't hammer Rust file
    // writes; 250ms is below user-perceivable latency but covers full
    // drag sessions nicely.
    let unlistenMoved: (() => void) | undefined;
    let moveDebounce: ReturnType<typeof setTimeout> | null = null;
    void win
      .onMoved(({ payload }) => {
        if (moveDebounce) clearTimeout(moveDebounce);
        moveDebounce = setTimeout(() => {
          void savePosition(payload.x, payload.y);
        }, 250);
      })
      .then((fn) => {
        unlistenMoved = fn;
      });

    return () => {
      unlisten?.();
      unlistenMoved?.();
      if (moveDebounce) clearTimeout(moveDebounce);
      // Capture final position on unmount — flushes the debounced write.
      void win.outerPosition().then((pos) => {
        void savePosition(pos.x, pos.y);
      });
    };
  }, []);
  // [END]

  // [START] Double-click focuses main window. Drag is handled natively by
  // `data-tauri-drag-region` on the outer div — no imperative startDragging
  // needed (and it actually breaks repeat drags because the previous drag
  // session can leave the window in a locked state).
  async function handleDoubleClick() {
    try {
      await invoke("focus_main_window");
    } catch {
      // ignore if main window not available
    }
  }
  // [END]

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => void handleDoubleClick()}
      onContextMenu={(e) => void handleContextMenu(e)}
      onPointerDown={() => {
        // [START] struggling while held — releases on pointerup / leave
        setPressState("struggling");
        setLastActivity(Date.now());
        // [END]
      }}
      onPointerUp={() => setPressState(null)}
      onPointerLeave={() => setPressState(null)}
      onPointerMove={() => setLastActivity(Date.now())}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        overflow: "visible",
      }}
    >
      {/* [START] Owl wrapped in pointer-events:none so the SVG doesn't eat
          the mousedown event — drag region on parent handles OS-native move.
          Owl uses ~80% of window size to leave headroom for breathe / bounce
          animations (up to ±6px transform). */}
      <div style={{ pointerEvents: "none" }}>
        <Owl state={owlState} size={size} />
      </div>
      {/* [END] */}
    </div>
  );
}
// [END]
