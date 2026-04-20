// [START] Phase 8.2 — xterm.js terminal component with PTY backend
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useCodeThemeStore, currentPreset } from "../../store/code_theme";

interface TerminalProps {
  projectRoot: string;
  visible: boolean;
}

export function Terminal({ projectRoot, visible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const presetId = useCodeThemeStore((s) => s.presetId);
  // [START] Phase 8.4 — in-app Korean IME toggle.
  // State drives the header badge; the ref feeds the key handler inside
  // the mount effect so we don't re-subscribe xterm on every toggle.
  const [koreanMode, setKoreanMode] = useState(false);
  const koreanModeRef = useRef(false);
  // [END]

  // [START] Initialize xterm + spawn PTY on mount
  useEffect(() => {
    if (!containerRef.current || !projectRoot) return;

    const preset = currentPreset(presetId);
    const term = new XTerm({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
      theme: {
        background: preset.background,
        foreground: preset.foreground,
        cursor: preset.cursor,
        selectionBackground: preset.selectionBg,
        ...(preset.ansi ?? {}),
      },
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Spawn PTY
    const cols = term.cols;
    const rows = term.rows;

    void (async () => {
      try {
        const ptyId = await invoke<string>("pty_spawn", {
          projectRoot,
          cols,
          rows,
        });
        ptyIdRef.current = ptyId;

        // Listen for PTY output events
        const unlisten = await listen<{ pty_id: string; data: string }>(
          "pty://output",
          (event) => {
            if (event.payload.pty_id === ptyId) {
              term.write(event.payload.data);
            }
          },
        );
        unlistenRef.current = unlisten;

        // [START] Phase 8.4 — In-app 2-beolsik Korean IME.
        // We bypass the OS IME entirely (inspired by Korean-IME.nvim).
        // The user disables macOS Korean input and toggles our mode with
        // Ctrl+Shift+K (or clicks the header badge). In Korean mode, we
        // intercept a-z keystrokes, map via 2-beolsik, assemble syllables
        // in JS, and send finished syllables (plus DELs to repaint) to
        // the PTY. Sidesteps every WKWebView IME bug entirely — no
        // compositionstart/end, no insertText/ReplacementText dance.
        const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
        const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
        const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
        const DIPHTHONG: Record<number, Record<number, number>> = {
          8:  { 0: 9, 1: 10, 20: 11 },
          13: { 4: 14, 5: 15, 20: 16 },
          18: { 20: 19 },
        };
        // 2-beolsik layout: English QWERTY key → jamo.
        const BEOLSIK: Record<string, string> = {
          q:"ㅂ",w:"ㅈ",e:"ㄷ",r:"ㄱ",t:"ㅅ",
          y:"ㅛ",u:"ㅕ",i:"ㅑ",o:"ㅐ",p:"ㅔ",
          a:"ㅁ",s:"ㄴ",d:"ㅇ",f:"ㄹ",g:"ㅎ",
          h:"ㅗ",j:"ㅓ",k:"ㅏ",l:"ㅣ",
          z:"ㅋ",x:"ㅌ",c:"ㅊ",v:"ㅍ",b:"ㅠ",n:"ㅜ",m:"ㅡ",
          Q:"ㅃ",W:"ㅉ",E:"ㄸ",R:"ㄲ",T:"ㅆ",O:"ㅒ",P:"ㅖ",
        };
        // 종성 jong index → new 초성 cho index (for syllable split).
        const JONG_TO_CHO: Record<number, number> = {
          1:0, 2:1, 4:2, 7:3, 8:5, 16:6, 17:7, 19:9, 20:10, 21:11,
          22:12, 23:14, 24:15, 25:16, 26:17, 27:18,
        };
        const composeSyllable = (cho: number, jung: number, jong: number) =>
          String.fromCharCode(0xAC00 + cho * 588 + jung * 28 + jong);
        const decomposeSyllable = (syl: string) => {
          const code = syl.charCodeAt(0);
          if (code < 0xAC00 || code > 0xD7A3) return null;
          const idx = code - 0xAC00;
          return {
            cho: Math.floor(idx / 588),
            jung: Math.floor((idx % 588) / 28),
            jong: idx % 28,
          };
        };

        // State: current syllable/jamo being built. Reset on non-jamo key,
        // Enter, Space, arrows, ctrl+c, mode toggle, etc.
        let pending = "";
        const delCount = (s: string) => "\x7f".repeat(Array.from(s).length);
        const writePty = (payload: string) => {
          if (payload) void invoke("pty_write", { ptyId, data: payload });
        };
        const resetPending = () => {
          pending = "";
        };

        // Handle one jamo keystroke in Korean mode. Returns true if the
        // key was consumed — caller should block xterm's default.
        const handleJamo = (jamo: string) => {
          // No pending → start fresh. Write jamo so user sees progress.
          if (!pending) {
            writePty(jamo);
            pending = jamo;
            return;
          }
          const jungIdx = JUNG.indexOf(jamo);
          const isVowel = jungIdx >= 0;

          // Pending is a single jamo (not yet a full syllable).
          if (pending.length === 1 && pending.charCodeAt(0) < 0xAC00) {
            const prev = pending;
            const prevCho = CHO.indexOf(prev);
            if (prevCho >= 0 && isVowel) {
              // consonant + vowel → new syllable (initial composition).
              const syl = composeSyllable(prevCho, jungIdx, 0);
              writePty(delCount(prev) + syl);
              pending = syl;
              return;
            }
            // Otherwise break — commit previous, start new with this jamo.
            writePty(jamo);
            pending = jamo;
            return;
          }

          // Pending is a full syllable (가-힣). Try extending.
          const dec = decomposeSyllable(pending);
          if (!dec) {
            writePty(jamo);
            pending = jamo;
            return;
          }

          if (!isVowel) {
            // Consonant. If no 종성 yet, try adding as 종성.
            if (dec.jong === 0) {
              const jongIdx = JONG.indexOf(jamo);
              if (jongIdx > 0) {
                const next = composeSyllable(dec.cho, dec.jung, jongIdx);
                writePty(delCount(pending) + next);
                pending = next;
                return;
              }
            }
            // Already has 종성 or not a valid 종성 → new syllable with jamo.
            writePty(jamo);
            pending = jamo;
            return;
          }

          // Vowel.
          if (dec.jong === 0) {
            // Try diphthong upgrade.
            const nextJung = DIPHTHONG[dec.jung]?.[jungIdx];
            if (nextJung !== undefined) {
              const next = composeSyllable(dec.cho, nextJung, 0);
              writePty(delCount(pending) + next);
              pending = next;
              return;
            }
            // No diphthong → commit previous, vowel starts standalone.
            writePty(jamo);
            pending = jamo;
            return;
          }
          // Syllable has 종성 + we get vowel → split: 종성 becomes new
          // syllable's 초성, add this vowel as 중성.
          const newCho = JONG_TO_CHO[dec.jong];
          if (newCho !== undefined) {
            const prevSyl = composeSyllable(dec.cho, dec.jung, 0);
            const newSyl = composeSyllable(newCho, jungIdx, 0);
            writePty(delCount(pending) + prevSyl + newSyl);
            pending = newSyl;
            return;
          }
          // Fallback — just append.
          writePty(jamo);
          pending = jamo;
        };

        // Backspace in Korean mode: peel one level off the current syllable.
        const handleBackspace = () => {
          if (!pending) return false;
          if (pending.length === 1 && pending.charCodeAt(0) < 0xAC00) {
            writePty("\x7f");
            pending = "";
            return true;
          }
          const dec = decomposeSyllable(pending);
          if (!dec) {
            writePty("\x7f");
            pending = "";
            return true;
          }
          if (dec.jong > 0) {
            const next = composeSyllable(dec.cho, dec.jung, 0);
            writePty(delCount(pending) + next);
            pending = next;
            return true;
          }
          // Has 중성 only → drop to 초성.
          const choJamo = CHO[dec.cho] ?? "";
          writePty(delCount(pending) + choJamo);
          pending = choJamo;
          return true;
        };

        // Terminal-level keydown listener. We run BEFORE xterm's own
        // handler so we can swallow keys the user meant as Korean.
        term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
          if (ev.type !== "keydown") return true;
          // Toggle Ctrl+Shift+K — flip Korean mode, reset pending.
          if (ev.ctrlKey && ev.shiftKey && (ev.key === "K" || ev.key === "k")) {
            ev.preventDefault();
            const next = !koreanModeRef.current;
            koreanModeRef.current = next;
            setKoreanMode(next);
            resetPending();
            return false;
          }
          // Non-Korean mode → let xterm handle everything.
          if (!koreanModeRef.current) return true;

          // Korean mode below. Handle jamo keys ourselves, block xterm.
          if (ev.ctrlKey || ev.metaKey || ev.altKey) {
            resetPending();
            return true;
          }
          if (ev.key === "Backspace") {
            if (handleBackspace()) {
              ev.preventDefault();
              return false;
            }
            return true;
          }
          const lookup = ev.shiftKey ? ev.key.toUpperCase() : ev.key.toLowerCase();
          const jamo = BEOLSIK[lookup];
          if (jamo) {
            ev.preventDefault();
            handleJamo(jamo);
            return false;
          }
          // Any non-jamo key commits the pending syllable.
          resetPending();
          return true;
        });

        term.onData((data) => {
          void invoke("pty_write", { ptyId, data });
        });
        // [END]
      } catch (e) {
        term.write(`\r\n\x1b[31mFailed to spawn terminal: ${e}\x1b[0m\r\n`);
      }
    })();

    return () => {
      // Cleanup
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (ptyIdRef.current) {
        void invoke("pty_kill", { ptyId: ptyIdRef.current });
        ptyIdRef.current = null;
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [projectRoot]);
  // [END]

  // [START] Resize on visibility change or container resize
  useEffect(() => {
    if (!visible || !fitAddonRef.current) return;
    // Small delay to let CSS layout settle
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit();
      if (ptyIdRef.current && xtermRef.current) {
        void invoke("pty_resize", {
          ptyId: ptyIdRef.current,
          cols: xtermRef.current.cols,
          rows: xtermRef.current.rows,
        });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [visible]);

  // ResizeObserver for dynamic resizing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && visible) {
        fitAddonRef.current.fit();
        if (ptyIdRef.current && xtermRef.current) {
          void invoke("pty_resize", {
            ptyId: ptyIdRef.current,
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [visible]);
  // [END]

  // [START] Phase 8.4 — live theme swap.
  // xterm's options.theme is writable; update it whenever the preset
  // changes so switches take effect without killing the PTY session.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    const preset = currentPreset(presetId);
    term.options.theme = {
      background: preset.background,
      foreground: preset.foreground,
      cursor: preset.cursor,
      selectionBackground: preset.selectionBg,
      ...(preset.ansi ?? {}),
    };
  }, [presetId]);
  // [END]

  const toggleKoreanMode = () => {
    const next = !koreanModeRef.current;
    koreanModeRef.current = next;
    setKoreanMode(next);
  };

  return (
    <div className={`w-full h-full relative ${visible ? "" : "hidden"}`}>
      {/* [START] Phase 8.4 — Korean IME badge overlay.
          Clickable toggle in the top-right corner of the terminal panel.
          Shows current mode (EN / 한). Keyboard shortcut: Ctrl+Shift+K. */}
      <button
        type="button"
        onClick={toggleKoreanMode}
        title="한/영 전환 (Ctrl+Shift+K)"
        className={`absolute top-1 right-2 z-10 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border transition ${
          koreanMode
            ? "bg-ovo-accent text-ovo-accent-ink border-ovo-accent"
            : "bg-ovo-chip/70 text-ovo-muted border-ovo-chip-border hover:text-ovo-text"
        }`}
      >
        {koreanMode ? "한" : "EN"}
      </button>
      {/* [END] */}
      <div ref={containerRef} className="w-full h-full" style={{ padding: 4 }} />
    </div>
  );
}
// [END] Phase 8.2
