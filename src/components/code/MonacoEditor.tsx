// [START] Phase 8 — Monaco editor wrapper with OVO theme integration
import { useRef, useCallback, useEffect, useState } from "react";
import Editor, {
  loader,
  type OnMount,
  type OnChange,
  type BeforeMount,
} from "@monaco-editor/react";
import { Sparkles } from "lucide-react";
import * as monaco from "monaco-editor";
import type { editor, languages, Position, CancellationToken } from "monaco-editor";
import { useCodeEditorStore } from "../../store/code_editor";
import { useCodeAgentStore } from "../../store/code_agent";
import { useCodeThemeStore, currentPreset, CODE_THEME_PRESETS } from "../../store/code_theme";
import { useCodeSettingsStore } from "../../store/code_settings";
import { requestCodeCompletion } from "../../lib/codeCompletion";
import { InlineChatBox } from "./InlineChatBox";
import i18n from "../../i18n";

// [START] Phase R — Monaco loader bootstrap for release CSP.
// `@monaco-editor/react` defaults to fetching monaco from cdn.jsdelivr.net,
// which the release CSP (`script-src 'self' ...`) blocks — the editor then
// sits on its loading spinner forever. Pointing `loader` at the bundled
// monaco-editor module + wiring `MonacoEnvironment.getWorkerUrl` to the
// worker bundles vite-plugin-monaco-editor emits under /monacoeditorwork/
// keeps everything self-hosted.
(self as unknown as { MonacoEnvironment: { getWorkerUrl: (moduleId: string, label: string) => string } }).MonacoEnvironment = {
  getWorkerUrl(_moduleId: string, label: string): string {
    if (label === "json") return "/monacoeditorwork/json.worker.bundle.js";
    if (label === "css" || label === "scss" || label === "less") return "/monacoeditorwork/css.worker.bundle.js";
    if (label === "html" || label === "handlebars" || label === "razor") return "/monacoeditorwork/html.worker.bundle.js";
    if (label === "typescript" || label === "javascript") return "/monacoeditorwork/ts.worker.bundle.js";
    return "/monacoeditorwork/editor.worker.bundle.js";
  },
};
loader.config({ monaco });
// [END]

interface MonacoEditorProps {
  path: string;
  content: string;
  language: string;
  onChange: (value: string) => void;
  onSave: () => void;
  // [START] Phase 4 — model ref used for FIM inline completion.
  // Provider is disabled when null/undefined (no active model). We read this
  // via a ref inside the provider closure so we don't re-register on every
  // model swap — the latest ref wins on the next keystroke.
  completionModelRef?: string | null;
  // [END]
}

// [START] Phase 8.4 — preset-driven Monaco themes.
// All themes register once per monaco instance (not per preset switch)
// because defineTheme is idempotent per name. Swapping themes is then a
// single setTheme call when the store's preset changes.
function registerPresetThemes(monaco: Parameters<OnMount>[1]) {
  for (const preset of Object.values(CODE_THEME_PRESETS)) {
    monaco.editor.defineTheme(`ovo-${preset.id.replace(/_/g, "-")}`, {
      base: preset.isDark ? "vs-dark" : "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": preset.background,
        "editor.foreground": preset.foreground,
        "editorCursor.foreground": preset.cursor,
        "editor.selectionBackground": preset.selectionBg,
        "editor.lineHighlightBackground": preset.lineHighlight,
        "editorLineNumber.foreground": preset.lineNumber,
        "editorLineNumber.activeForeground": preset.lineNumberActive,
        "editorWidget.background": preset.widgetBg,
        "editorWidget.border": preset.widgetBorder,
      },
    });
  }
}
// [END]

export function MonacoEditor({
  path,
  content,
  language,
  onChange,
  onSave,
  completionModelRef,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const presetId = useCodeThemeStore((s) => s.presetId);
  const preset = currentPreset(presetId);
  const themeName = `ovo-${preset.id.replace(/_/g, "-")}`;

  // [START] Phase 5 — settings subscription.
  const fontSize = useCodeSettingsStore((s) => s.fontSize);
  const tabSize = useCodeSettingsStore((s) => s.tabSize);
  const wordWrap = useCodeSettingsStore((s) => s.wordWrap);
  const minimap = useCodeSettingsStore((s) => s.minimap);
  const lineNumbers = useCodeSettingsStore((s) => s.lineNumbers);
  // autoSave + autoSaveDelay are read via getState() in handlers so we skip
  // a reactive subscription (doesn't affect the editor surface).
  const completionEnabled = useCodeSettingsStore((s) => s.completionEnabled);
  const completionDelayMs = useCodeSettingsStore((s) => s.completionDelayMs);
  // [END]

  // [START] Phase 4 + 5 — live refs so the once-registered completion provider
  // always sees the latest props without re-registering.
  const completionModelRefRef = useRef<string | null | undefined>(completionModelRef);
  const completionLanguageRef = useRef<string>(language);
  const completionEnabledRef = useRef<boolean>(completionEnabled);
  const completionDelayRef = useRef<number>(completionDelayMs);
  useEffect(() => {
    completionModelRefRef.current = completionModelRef;
  }, [completionModelRef]);
  useEffect(() => {
    completionLanguageRef.current = language;
  }, [language]);
  useEffect(() => {
    completionEnabledRef.current = completionEnabled;
  }, [completionEnabled]);
  useEffect(() => {
    completionDelayRef.current = completionDelayMs;
  }, [completionDelayMs]);
  // [END]

  // [START] Phase 5 — autoSave implementation.
  // `afterDelay`: debounce onChange by autoSaveDelay and call onSave.
  // `onFocusChange`: save when the editor loses focus.
  // `off`: do nothing (user presses Cmd+S).
  const autoSaveTimerRef = useRef<number | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  // [END]

  // [START] Phase 5 — Inline Chat (Cmd+I).
  // Tracks whether the overlay box is visible plus a snapshot of the
  // selection at trigger time so the replace-on-accept call doesn't race
  // against cursor movement while the model generates.
  const [inlineChatOpen, setInlineChatOpen] = useState(false);
  const [inlineSelection, setInlineSelection] = useState("");
  const inlineSelectionRangeRef = useRef<{
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null>(null);
  // [END]

  // [START] Phase 5 — "✨" quick-action button that floats at the end of
  // any live selection and opens Inline Chat when clicked. Anchored in
  // editor-container coordinates via Monaco's getScrolledVisiblePosition,
  // so scrolling the editor moves the button too — we refresh on every
  // selection change (selection change fires on scroll via cursor tracking).
  const [inlineActionPos, setInlineActionPos] = useState<{ x: number; y: number } | null>(null);
  // [END]

  // [START] Phase 8.4 — register themes BEFORE mount so the `theme` prop
  // on <Editor> doesn't fall back to a white default while onMount is
  // still pending. Without this, the editor briefly paints white on
  // every tab switch.
  const handleBeforeMount: BeforeMount = useCallback(
    (monaco) => {
      registerPresetThemes(monaco);
    },
    [],
  );
  // [END]

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      registerPresetThemes(monaco);
      monaco.editor.setTheme(themeName);

      // [START] Cmd+S → save
      editor.addAction({
        id: "ovo-save",
        label: "Save File",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => onSave(),
      });
      // [END]

      // [START] Phase 5 — Cmd+I → Inline Chat.
      // Captures the active selection (or a collapsed range at the cursor)
      // so the rewrite target doesn't change while the user types the
      // prompt or the model generates.
      editor.addAction({
        id: "ovo-inline-chat",
        label: "Inline Chat",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        run: () => {
          const sel = editor.getSelection();
          const model = editor.getModel();
          if (!sel || !model) return;
          const text = sel.isEmpty() ? "" : model.getValueInRange(sel);
          inlineSelectionRangeRef.current = {
            startLineNumber: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLineNumber: sel.endLineNumber,
            endColumn: sel.endColumn,
          };
          setInlineSelection(text);
          setInlineChatOpen(true);
        },
      });
      // [END]

      // [START] Phase 8.4 — custom context menu actions.
      // Injected into Monaco's native right-click menu via
      // `contextMenuGroupId`. The "ovo" group lands above navigation and
      // below clipboard, which mirrors how VS Code places agent actions.
      // Each action either pushes the current selection into the agent
      // composer (as a pre-filled prompt) or attaches the whole file as
      // a chip — the AgentChat subscribes to the same store so the user
      // sees the result instantly without switching focus.
      const OVO_GROUP = "ovo";
      const getSelectedText = (): {
        text: string;
        startLine: number;
        endLine: number;
      } | null => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model || sel.isEmpty()) return null;
        const text = model.getValueInRange(sel);
        if (text.length === 0) return null;
        return {
          text,
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
        };
      };

      // Use i18n for label; fall back to Korean string if key missing.
      const tr = (key: string, fallback: string): string => {
        try {
          const v = i18n.t(key);
          return typeof v === "string" && v.length > 0 && v !== key ? v : fallback;
        } catch {
          return fallback;
        }
      };
      editor.addAction({
        id: "ovo-add-selection-to-chat",
        label: tr("code.ctx.add_selection_to_chat", "선택 영역을 에이전트 챗에 추가"),
        contextMenuGroupId: OVO_GROUP,
        contextMenuOrder: 1,
        precondition: "editorHasSelection",
        run: () => {
          const sel = getSelectedText();
          if (!sel) return;
          const block = `<editor_selection path="${path}" lines="${sel.startLine}-${sel.endLine}">\n${sel.text}\n</editor_selection>`;
          useCodeAgentStore.getState().appendToComposer(block);
        },
      });

      editor.addAction({
        id: "ovo-explain-selection",
        label: tr("code.ctx.explain_selection", "선택 영역 설명 요청"),
        contextMenuGroupId: OVO_GROUP,
        contextMenuOrder: 2,
        precondition: "editorHasSelection",
        run: () => {
          const sel = getSelectedText();
          if (!sel) return;
          const prompt = tr("code.ctx.explain_prompt", "다음 코드를 설명해줘")
            + ` (${path}:${sel.startLine}-${sel.endLine}):\n\n\`\`\`\n${sel.text}\n\`\`\``;
          useCodeAgentStore.getState().appendToComposer(prompt);
        },
      });

      editor.addAction({
        id: "ovo-review-selection",
        label: tr("code.ctx.review_selection", "선택 영역 리뷰 요청"),
        contextMenuGroupId: OVO_GROUP,
        contextMenuOrder: 3,
        precondition: "editorHasSelection",
        run: () => {
          const sel = getSelectedText();
          if (!sel) return;
          const prompt = tr(
            "code.ctx.review_prompt",
            "다음 코드 리뷰해줘. 버그 / 타입 안전성 / 네이밍 / 단순화 여부를 확인하고 수정 제안",
          ) + ` (${path}:${sel.startLine}-${sel.endLine}):\n\n\`\`\`\n${sel.text}\n\`\`\``;
          useCodeAgentStore.getState().appendToComposer(prompt);
        },
      });

      editor.addAction({
        id: "ovo-add-file-to-chat",
        label: tr("code.ctx.add_file_to_chat", "이 파일을 에이전트 챗에 추가"),
        contextMenuGroupId: OVO_GROUP,
        contextMenuOrder: 4,
        run: () => {
          useCodeAgentStore.getState().addAttachment(path);
        },
      });
      // [END]

      // [START] Phase 4 — AI inline completion (FIM ghost text).
      // Monaco drives the provider: on every cursor move / keystroke it
      // calls provideInlineCompletions, cancelling the previous call via
      // the CancellationToken. We layer a 300ms debounce on top (wait,
      // then bail early if the token fires during the wait) so rapid
      // typing doesn't hammer the sidecar. The 14B Coder quant takes
      // ~200-600ms for a 30-token FIM on M-series unified memory, so
      // ghost text lands within one visual frame of the user pausing.
      //
      // Registered once per mount against the language set the editor
      // declares. We look up the current completion model through a ref
      // so we don't have to re-register on every model swap.
      // Provider object — older Monaco builds called `freeInlineCompletions`,
      // current ones call `disposeInlineCompletions`. Our TS typings carry
      // the current name; we attach the legacy alias via a post-hoc cast so
      // both build generations see a no-op.
      const completionProvider: languages.InlineCompletionsProvider = {
        provideInlineCompletions: async (
          model: editor.ITextModel,
          position: Position,
          _ctx: languages.InlineCompletionContext,
          token: CancellationToken,
        ) => {
          const modelRefNow = completionModelRefRef.current;
          if (!modelRefNow) return { items: [] };
          if (!completionEnabledRef.current) return { items: [] };

          // Configurable debounce — race a timer against token cancellation.
          const delay = completionDelayRef.current;
          const proceed = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), delay);
            token.onCancellationRequested(() => {
              clearTimeout(timer);
              resolve(false);
            });
          });
          if (!proceed || token.isCancellationRequested) {
            return { items: [] };
          }

          const offset = model.getOffsetAt(position);
          const full = model.getValue();
          const prefix = full.slice(0, offset);
          const suffix = full.slice(offset);

          // Skip if there's no prefix (empty file or very start) — FIM
          // against an empty prefix produces boilerplate noise.
          if (prefix.trim().length === 0) return { items: [] };

          // Cap context sent to the sidecar. A 200KB file doesn't help
          // the model and bloats prefill; 4KB on each side covers the
          // surrounding function or module comfortably.
          const PREFIX_CAP = 4096;
          const SUFFIX_CAP = 2048;
          const trimmedPrefix =
            prefix.length > PREFIX_CAP
              ? prefix.slice(prefix.length - PREFIX_CAP)
              : prefix;
          const trimmedSuffix =
            suffix.length > SUFFIX_CAP ? suffix.slice(0, SUFFIX_CAP) : suffix;

          // Bridge CancellationToken → fetch AbortSignal so the HTTP
          // request cancels the moment the user presses another key.
          const abort = new AbortController();
          const cancelListener = token.onCancellationRequested(() =>
            abort.abort(),
          );
          let text = "";
          try {
            text = await requestCodeCompletion(
              {
                model: modelRefNow,
                prefix: trimmedPrefix,
                suffix: trimmedSuffix,
                language: completionLanguageRef.current,
                max_tokens: 128,
                temperature: 0.2,
              },
              abort.signal,
            );
          } finally {
            cancelListener.dispose();
          }

          if (!text || token.isCancellationRequested) return { items: [] };

          return {
            items: [
              {
                insertText: text,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
              },
            ],
          };
        },
        disposeInlineCompletions: () => {
          // Per-request AbortController handles cleanup; nothing shared here.
        },
      };
      // Legacy alias for older Monaco builds that still call
      // `freeInlineCompletions`. Attached after object construction so the
      // current TS type (which doesn't know the alias) stays satisfied.
      (completionProvider as unknown as {
        freeInlineCompletions?: (...args: unknown[]) => void;
      }).freeInlineCompletions = () => {};

      const completionDisposable =
        monaco.languages.registerInlineCompletionsProvider(
          { pattern: "**" },
          completionProvider,
        );
      // Dispose on editor teardown so HMR + tab-switch don't stack providers.
      editor.onDidDispose(() => completionDisposable.dispose());
      // [END]

      // [START] Phase 8 — selection → code_editor.editorSelection.
      // Fires on every cursor/selection change; we only push a non-null
      // snapshot when the user actually has a range highlighted. The
      // AgentChat composer subscribes to this so it can show a "N lines
      // selected" chip and (later) inject the snippet into the next turn.
      // Listener is attached via addDisposableListener; onMount's returned
      // cleanup isn't supported by @monaco-editor/react so we rely on
      // editor disposal when the parent unmounts the host div.
      // [START] Phase 5 — compute floating ✨ button position from the
      // selection's end. Skipped when the selection collapses (no range).
      const updateInlineActionPos = () => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model || sel.isEmpty()) {
          setInlineActionPos(null);
          return;
        }
        const end = sel.getEndPosition();
        const vis = editor.getScrolledVisiblePosition({
          lineNumber: end.lineNumber,
          column: end.column,
        });
        if (!vis) {
          setInlineActionPos(null);
          return;
        }
        // Nudge the button a hair to the right of the selection tail and
        // down so it sits on the baseline — consistent with VS Code's
        // sparkle placement. Container has `relative` so the coords map
        // 1:1 with the overlay.
        setInlineActionPos({ x: vis.left + 6, y: vis.top });
      };
      // [END]

      editor.onDidChangeCursorSelection((e) => {
        const sel = e.selection;
        const model = editor.getModel();
        if (!model || sel.isEmpty()) {
          useCodeEditorStore.getState().setEditorSelection(null);
          setInlineActionPos(null);
          return;
        }
        const text = model.getValueInRange(sel);
        if (text.length === 0) {
          useCodeEditorStore.getState().setEditorSelection(null);
          setInlineActionPos(null);
          return;
        }
        useCodeEditorStore.getState().setEditorSelection({
          path,
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
          text,
        });
        updateInlineActionPos();
      });
      // Track scrolling so the ✨ button follows the selection tail as the
      // user scrolls the file — otherwise it'd appear to drift.
      editor.onDidScrollChange(() => updateInlineActionPos());
      // [END]

      // [START] Phase 5 — focus-change auto-save.
      // Fires only when the user has enabled onFocusChange mode. Editor
      // losing focus via tab switch / window blur / clicking outside all
      // trigger onDidBlurEditorText.
      editor.onDidBlurEditorText(() => {
        const mode = useCodeSettingsStore.getState().autoSave;
        if (mode === "onFocusChange") {
          try {
            onSaveRef.current();
          } catch {
            /* save is best-effort; user can retry with Cmd+S */
          }
        }
      });
      // [END]

      editor.focus();
    },
    [themeName, onSave, path],
  );

  const handleChange: OnChange = useCallback(
    (value) => {
      if (value === undefined) return;
      onChange(value);

      // [START] Phase 5 — debounced auto-save (afterDelay mode).
      // Store reads happen through the store to avoid re-creating this
      // callback whenever settings change; each keystroke rescheds the
      // timer so we only save once the user pauses.
      const { autoSave: mode, autoSaveDelay: delay } = useCodeSettingsStore.getState();
      if (mode === "afterDelay") {
        if (autoSaveTimerRef.current !== null) {
          window.clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = window.setTimeout(() => {
          autoSaveTimerRef.current = null;
          try {
            onSaveRef.current();
          } catch {
            /* best-effort */
          }
        }, delay);
      }
      // [END]
    },
    [onChange],
  );

  // [START] Phase 5 — clear any pending auto-save timer on unmount so the
  // callback doesn't fire against a stale (freed) tab.
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, []);
  // [END]

  // [START] Phase 5 — open Inline Chat from the floating ✨ button.
  // Same selection-snapshot pattern as the Cmd+I action so the rewrite
  // range stays pinned even after the user takes focus off the editor
  // to type into the prompt box.
  const openInlineChatFromSelection = useCallback(() => {
    const ed = editorRef.current;
    const sel = ed?.getSelection();
    const model = ed?.getModel();
    if (!ed || !sel || !model) return;
    const text = sel.isEmpty() ? "" : model.getValueInRange(sel);
    inlineSelectionRangeRef.current = {
      startLineNumber: sel.startLineNumber,
      startColumn: sel.startColumn,
      endLineNumber: sel.endLineNumber,
      endColumn: sel.endColumn,
    };
    setInlineSelection(text);
    setInlineChatOpen(true);
    setInlineActionPos(null);
  }, []);
  // [END]

  // [START] Phase 5 — Inline Chat accept handler.
  // Replaces the captured range with the model's output via
  // editor.executeEdits so Monaco's own undo stack records the edit
  // (Cmd+Z rolls it back). When there was no selection at trigger time
  // the range is collapsed, so executeEdits inserts at the cursor.
  const handleInlineAccept = useCallback((newText: string) => {
    const ed = editorRef.current;
    const range = inlineSelectionRangeRef.current;
    if (!ed || !range) return;
    ed.executeEdits("inline-chat", [
      {
        range,
        text: newText,
        forceMoveMarkers: true,
      },
    ]);
    setInlineChatOpen(false);
    ed.focus();
  }, []);
  // [END]

  return (
    <div className="relative h-full w-full">
      <Editor
      key={path}
      defaultValue={content}
      language={language}
      theme={themeName}
      onChange={handleChange}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        fontSize,
        fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
        minimap: { enabled: minimap },
        scrollBeyondLastLine: false,
        wordWrap,
        tabSize,
        lineNumbers: lineNumbers ? "on" : "off",
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        automaticLayout: true,
        padding: { top: 8 },
        // [START] Phase 4 — enable ghost-text rendering of InlineCompletions.
        // `mode: "subword"` lets partial-word prefix matches surface the
        // provider's suggestion; Tab accepts, Esc or any keystroke cancels.
        // When `completionEnabled` is off, the provider returns empty early
        // — we still keep the option enabled so future re-enables don't
        // require remounting the editor.
        inlineSuggest: { enabled: true, mode: "subword" },
        // [END]
      }}
      />
      {/* [START] Phase 5 — ✨ Inline Chat quick-action button.
          Follows the tail of the live selection. `onMouseDown`
          preventDefault() keeps Monaco's selection from collapsing when
          the user aims at the button — without it, clicking would clear
          the selection before we can snapshot it. */}
      {inlineActionPos && !inlineChatOpen && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openInlineChatFromSelection}
          title="Inline Chat (Cmd+I)"
          aria-label="Inline Chat"
          className="absolute z-20 p-1 rounded-md bg-ovo-accent text-ovo-accent-ink shadow-lg hover:scale-110 transition-transform"
          style={{
            left: inlineActionPos.x,
            top: inlineActionPos.y,
            transform: "translate(4px, -4px)",
          }}
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}
      {/* [END] */}
      {/* [START] Phase 5 — Inline Chat overlay.
          Anchored at top-center of the editor container via `absolute`.
          Only rendered while open so the editor stays interactive when
          the feature isn't in use. */}
      <InlineChatBox
        open={inlineChatOpen}
        modelRef={completionModelRef ?? null}
        path={path}
        language={language}
        selection={inlineSelection}
        fullText={content}
        onAccept={handleInlineAccept}
        onClose={() => setInlineChatOpen(false)}
      />
      {/* [END] */}
    </div>
  );
}
// [END] Phase 8
