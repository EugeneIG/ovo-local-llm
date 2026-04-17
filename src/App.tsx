import { useState } from "react";
import { Owl, OWL_SIZES, type OwlSize, type OwlState } from "./components/Owl";

const STATES: OwlState[] = ["idle", "thinking", "typing", "happy", "sleeping", "surprised", "error", "struggling"];
const SIZES: OwlSize[] = ["xs", "sm", "md", "lg", "xl"];

export default function App() {
  const [state, setState] = useState<OwlState>("idle");
  const [size, setSize] = useState<OwlSize>("lg");
  const [grabbed, setGrabbed] = useState(false);

  const effectiveState = grabbed ? "struggling" : state;

  return (
    <div className="min-h-screen bg-[#FAF3E7] text-[#2C1810] flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center flex flex-col items-center">
        <button
          onMouseDown={() => setGrabbed(true)}
          onMouseUp={() => setGrabbed(false)}
          onMouseLeave={() => setGrabbed(false)}
          onTouchStart={() => setGrabbed(true)}
          onTouchEnd={() => setGrabbed(false)}
          className="cursor-grab active:cursor-grabbing select-none bg-transparent border-0 p-0"
          title="누르면 발버둥 🦉"
        >
          <Owl state={effectiveState} size={size} />
        </button>
        <h1 className="text-4xl font-semibold tracking-tight mt-4">OVO</h1>
        <p className="mt-1 text-[#8B4432]">Local MLX LLM runtime</p>
        <p className="mt-1 text-sm text-[#B85D3F]">Phase 0 — click the owl to grab it</p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="text-xs text-[#8B4432] uppercase tracking-wider">state</div>
        <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={`px-4 py-2 rounded-full text-sm transition ${
                state === s
                  ? "bg-[#D97757] text-white shadow-md"
                  : "bg-white text-[#8B4432] border border-[#E8CFBB] hover:bg-[#F4D4B8]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="text-xs text-[#8B4432] uppercase tracking-wider">size</div>
        <div className="flex gap-2 justify-center">
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`px-4 py-2 rounded-full text-sm transition ${
                size === s
                  ? "bg-[#8B4432] text-white shadow-md"
                  : "bg-white text-[#8B4432] border border-[#E8CFBB] hover:bg-[#F4D4B8]"
              }`}
            >
              {s} · {OWL_SIZES[s]}px
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 md:grid-cols-8 gap-4 opacity-80 pt-4 border-t border-[#E8CFBB] w-full max-w-4xl">
        {STATES.map((s) => (
          <div key={s} className="flex flex-col items-center">
            <Owl state={s} size="sm" />
            <span className="text-xs text-[#8B4432] mt-1">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
