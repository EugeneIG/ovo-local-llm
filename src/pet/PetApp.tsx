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
// Position persisted to localStorage "ovo:pet_position".

const LS_POSITION_KEY = "ovo:pet_position";
const LS_SIZE_KEY = "ovo:pet_size";
const DEFAULT_SIZE = 320;
const SIZE_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "작게 (160)", value: 160 },
  { label: "보통 (220)", value: 220 },
  { label: "크게 (320)", value: 320 },
  { label: "매우 크게 (420)", value: 420 },
];

interface SavedPosition {
  x: number;
  y: number;
}

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

function readSavedPosition(): SavedPosition | null {
  try {
    const raw = localStorage.getItem(LS_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPosition;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function savePosition(x: number, y: number): void {
  try {
    localStorage.setItem(LS_POSITION_KEY, JSON.stringify({ x, y }));
  } catch {
    // storage unavailable — silent
  }
}

export function PetApp() {
  const [owlState, setOwlState] = useState<OwlState>("idle");
  const [size, setSize] = useState<number>(() => readSavedSize());

  // [START] Apply size to the window whenever `size` state changes.
  useEffect(() => {
    void getCurrentWindow().setSize(new LogicalSize(size, size));
    saveSize(size);
  }, [size]);
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

    // Restore position
    const saved = readSavedPosition();
    if (saved) {
      void win.setPosition(new PhysicalPosition(saved.x, saved.y));
    }

    // Subscribe to owl state from main window
    let unlisten: (() => void) | undefined;
    void listen<{ state: OwlState }>("owl:state", (e) => {
      setOwlState(e.payload.state);
    }).then((fn) => {
      unlisten = fn;
    });

    // Subscribe to Tauri move events to persist position
    let unlistenMoved: (() => void) | undefined;
    void listen<{ x: number; y: number }>("tauri://move", (e) => {
      savePosition(e.payload.x, e.payload.y);
    }).then((fn) => {
      unlistenMoved = fn;
    });

    return () => {
      unlisten?.();
      unlistenMoved?.();
      // Capture final position on unmount
      void win.outerPosition().then((pos) => {
        savePosition(pos.x, pos.y);
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
