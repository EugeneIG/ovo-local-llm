// [START] Phase 8.3 — Code agent chat store
// Independent from main chat store. Handles streaming + tool-use loop
// for the code IDE agent panel.
//
// Phase 8 (A2): hot loop delegated to lib/chatEngine.runStreamTurn so this
// store and the main chat store share think-transition, repetition guard,
// and tool_use detection logic. Wire build / DB persistence / tool dispatch
// stay here because the code agent's schema and side effects differ from
// plain chat.
import { create } from "zustand";
import { type ChatWireMessage, generateConstrainedToolCall } from "../lib/api";
import { runStreamTurn } from "../lib/chatEngine";
import { useSidecarStore } from "./sidecar";
import { useCodeEditorStore } from "./code_editor";
import { useCodeGitStore } from "./code_git";
import { useChatSettingsStore } from "./chat_settings";
import { useToolModeStore } from "./tool_mode";
import {
  appendCodeMessage,
  listCodeMessages,
  clearCodeMessages,
  updateCodeMessageContent,
} from "../db/code_sessions";
import {
  buildAgentToolsPrompt,
  dispatchCodeAgentTool,
  runTscCheck,
  CODE_AGENT_TOOLS,
} from "../lib/codeAgentTools";
import { TOOL_OPEN_TAGS, TOOL_CLOSE_TAGS } from "../lib/toolUse";
import type { AgentTodoItem, CodeAgentMessage } from "../types/code";
import type { OwlState } from "../components/Owl";

// [START] Phase 8 — tool loop budget.
// Mirrors Claude Code: no artificial small-N cap. Real runaway loops are
// caught by DUPLICATE_LIMIT (same fingerprint twice), the malformed
// tool_use handler (truncated/unclosed blocks), the stuck-stream watchdog
// (30s no delta), and tool_result auto-truncation (10KB+). With those
// guards in place the budget exists only to bound genuine multi-step work
// — building a landing page from scratch easily takes 7-15 tool calls
// (multiple components + page integration + config files), so 5 was way
// too tight. 50 is "effectively unlimited" for normal sessions while still
// preventing pathological infinite recursion if every guard somehow fails.
const MAX_TOOL_LOOPS = 50;
// Duplicate-call guard — if the same (name, args) fingerprint shows up
// twice within one turn we short-circuit and feed the model a synthetic
// result that says "you already called this". See _sendLoop below.
const DUPLICATE_LIMIT = 2;
// [END]

// [START] Phase 8.4 — wire compaction budget.
// Local MLX models do full prefill on the entire message history every turn,
// so cost scales quadratically with session length. A 40-turn IDE session
// routinely produces 200KB+ of messages (every read_file dumps file content,
// every write_file echoes it back, every build error runs hundreds of lines).
// That blows past both the model's context window and the user's patience
// (60s+ first-token latency).
// Strategy: keep recent messages verbatim, truncate big historical
// tool_results, and replace very old history with a single synthetic
// summary. The model can always call read_file to re-fetch anything that
// was elided — this is cheaper than sending everything every turn.
const WIRE_CHAR_BUDGET = 60_000; // ~15K tokens of history (leaves room for new gen)
const WIRE_RECENT_TOOL_RESULT_CAP = 2_000; // truncate each historical tool_result past this
const WIRE_RECENT_ASSISTANT_CAP = 4_000; // truncate long historical assistant turns
const WIRE_KEEP_VERBATIM_LAST = 6; // never touch the last N messages

function compactWireBody(
  raw: ReadonlyArray<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  if (raw.length === 0) return [];
  // Walk from newest to oldest, keep within budget. Anything that falls
  // outside gets collapsed into a single "[...N earlier messages elided...]"
  // user-role note at the front of the wire.
  const kept: Array<{ role: string; content: string }> = [];
  let used = 0;
  let elidedCount = 0;
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i];
    const withinVerbatim = raw.length - 1 - i < WIRE_KEEP_VERBATIM_LAST;
    let content = m.content;
    // Per-message trimming for historical bulk messages.
    if (!withinVerbatim) {
      if (m.role === "tool_result" && content.length > WIRE_RECENT_TOOL_RESULT_CAP) {
        const head = content.slice(0, WIRE_RECENT_TOOL_RESULT_CAP);
        content = `${head}\n… [tool_result truncated — ${content.length} bytes originally; call read_file again if you need the rest]`;
      } else if (m.role === "assistant" && content.length > WIRE_RECENT_ASSISTANT_CAP) {
        const head = content.slice(0, WIRE_RECENT_ASSISTANT_CAP);
        content = `${head}\n… [assistant turn truncated — ${content.length} bytes originally]`;
      }
    }
    if (used + content.length > WIRE_CHAR_BUDGET && !withinVerbatim) {
      elidedCount = i + 1;
      break;
    }
    used += content.length;
    kept.push({ role: m.role, content });
  }
  kept.reverse();
  if (elidedCount > 0) {
    kept.unshift({
      role: "user",
      content: `[${elidedCount} earlier message(s) elided to fit context budget. Use read_file / list_dir to re-fetch anything you need.]`,
    });
  }
  return kept;
}
// [END]

// [START] Phase 8.4 B-track — tool_result auto-truncate.
// Big tool results (a 10k-line file dropped straight into the chat history)
// silently push the model past its context window two turns later — the
// stream just stops with no error. We cap each result at ~10KB on the wire:
// if the dispatcher returns an object with a `content` string that blows
// past the threshold, swap the body for the head + a marker the model can
// read ("you only got the first N lines, call read_file with start_line/
// end_line to page through the rest"). All other shapes pass through.
const TOOL_RESULT_MAX_BYTES = 10_000;
const TOOL_RESULT_HEAD_LINES = 200;

function truncateToolResult(toolResult: unknown): unknown {
  const json = JSON.stringify(toolResult);
  if (json.length <= TOOL_RESULT_MAX_BYTES) return toolResult;
  if (toolResult === null || typeof toolResult !== "object") return toolResult;
  const rec = toolResult as Record<string, unknown>;
  const content = rec.content;
  if (typeof content !== "string") return toolResult;
  const lines = content.split("\n");
  const head = lines.slice(0, TOOL_RESULT_HEAD_LINES).join("\n");
  return {
    ...rec,
    content: head,
    truncated: true,
    truncated_reason:
      `result was ${json.length} bytes (cap ${TOOL_RESULT_MAX_BYTES}); ` +
      `showing first ${TOOL_RESULT_HEAD_LINES} of ${lines.length} lines. ` +
      `Re-call read_file with start_line/end_line to page through the rest.`,
    head_lines: TOOL_RESULT_HEAD_LINES,
    total_lines: lines.length,
    original_size_bytes: json.length,
  };
}
// [END]

interface CodeAgentState {
  messages: CodeAgentMessage[];
  streaming: boolean;
  owlState: OwlState;
  error: string | null;
  abortController: AbortController | null;
  // [START] Phase 8 — message queue. Typed while a stream is in flight so
  // the user can line up the next instruction without waiting. Drained
  // automatically when the current turn completes.
  queue: string[];
  // [END]
  // [START] Phase 8 C3 — live todo list from the agent.
  // Replaced wholesale on every `todo_write` call so the agent can show a
  // transparent plan + progress bar at the top of the panel. Cleared on
  // every new user turn so stale plans don't hang around.
  todos: AgentTodoItem[];
  // [END]
  // [START] Phase 8 C2 — tool-approval modal (ask mode).
  // When the user is in `ask` mode, the engine pauses before any tool
  // that touches the filesystem and publishes a pendingApproval. The
  // AgentChat renders a modal with the tool name + args, the user
  // answers, and `resolve` is called back through the stored promise.
  pendingApproval: {
    toolName: string;
    args: Record<string, unknown>;
    resolve: (approved: boolean) => void;
  } | null;
  // [END]
  // [START] Phase 8.4 — composer state lifted to store.
  // Attachment chips and "append to input" triggers originally lived inside
  // AgentChat as useState — which meant other surfaces (file explorer
  // context menu, editor selection context menu) couldn't feed content
  // into the composer. Moving them here keeps AgentChat simple and lets
  // any component dispatch into the same conversation.
  attachments: string[];
  // A monotonically-updated pending text payload. AgentChat subscribes,
  // appends to its local input on change, then calls consumeComposerText
  // so repeat writes of the same text still fire.
  pendingComposerText: { id: number; text: string } | null;
  // [END]

  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string, modelRef: string) => Promise<void>;
  enqueueMessage: (content: string) => void;
  removeQueueItem: (index: number) => void;
  clearQueue: () => void;
  setTodos: (todos: AgentTodoItem[]) => void;
  requestApproval: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  respondApproval: (approved: boolean) => void;
  stopStreaming: () => void;
  clearMessages: (sessionId: string) => Promise<void>;
  // [START] Phase 8.4 — composer actions.
  addAttachment: (path: string) => void;
  removeAttachment: (path: string) => void;
  clearAttachments: () => void;
  appendToComposer: (text: string) => void;
  consumeComposerText: () => void;
  // [END]
}

export const useCodeAgentStore = create<CodeAgentState>((set, get) => ({
  messages: [],
  streaming: false,
  owlState: "idle" as OwlState,
  error: null,
  abortController: null,
  queue: [],
  todos: [],
  pendingApproval: null,
  attachments: [],
  pendingComposerText: null,

  // [START] Phase 8.4 — composer store actions.
  addAttachment: (path) => {
    set((s) =>
      s.attachments.includes(path) ? s : { attachments: [...s.attachments, path] },
    );
    // [START] Phase 5 — register with Rust whitelist so code_fs_read_external_file
    // is allowed to read this path later. Best-effort; errors fall silent so
    // a missing Tauri runtime (browser preview) doesn't break the UI.
    if (path.startsWith("/")) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("attachment_whitelist_register", { path }).catch(() => void 0),
      );
    }
    // [END]
  },
  removeAttachment: (path) =>
    set((s) => ({ attachments: s.attachments.filter((p) => p !== path) })),
  clearAttachments: () => {
    set({ attachments: [] });
    // [START] Phase 5 — clear Rust whitelist when the composer drops everything.
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("attachment_whitelist_clear").catch(() => void 0),
    );
    // [END]
  },
  appendToComposer: (text) =>
    set({ pendingComposerText: { id: Date.now(), text } }),
  consumeComposerText: () => set({ pendingComposerText: null }),
  // [END]

  loadMessages: async (sessionId) => {
    try {
      const msgs = await listCodeMessages(sessionId);
      set({ messages: msgs });
    } catch {
      set({ messages: [] });
    }
  },

  clearMessages: async (sessionId) => {
    await clearCodeMessages(sessionId);
    set({ messages: [], queue: [], todos: [] });
  },

  requestApproval: (toolName, args) => {
    return new Promise<boolean>((resolve) => {
      set({ pendingApproval: { toolName, args, resolve } });
    });
  },

  respondApproval: (approved) => {
    const current = get().pendingApproval;
    if (!current) return;
    current.resolve(approved);
    set({ pendingApproval: null });
  },

  setTodos: (todos) => {
    // Shallow validation so a malformed tool payload can't poison the UI.
    const clean = todos
      .filter((t) => t && typeof t.content === "string" && t.content.trim().length > 0)
      .map((t) => ({
        content: t.content.trim(),
        status:
          t.status === "completed" || t.status === "in_progress" || t.status === "pending"
            ? t.status
            : "pending",
      }));
    set({ todos: clean });
  },

  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) abortController.abort();
  },

  // [START] enqueueMessage — always pushes onto the queue; _sendLoop's
  // drain step pops the next one once the current turn finishes. If
  // nothing is streaming when this is called, we kick the drainer
  // synchronously so the queue still progresses.
  enqueueMessage: (content) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    set((s) => ({ queue: [...s.queue, trimmed] }));
  },
  // [END]

  // [START] Phase 8 — queue management (cancel individual / clear all).
  // Lets the user drop a queued instruction before it runs without having
  // to nuke the current stream. Index is the queue-array position as shown
  // in the chip row.
  removeQueueItem: (index) => {
    set((s) => ({ queue: s.queue.filter((_, i) => i !== index) }));
  },
  clearQueue: () => {
    set({ queue: [] });
  },
  // [END]

  sendMessage: async (sessionId, content, modelRef) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const projectRoot = useCodeEditorStore.getState().projectPath;
    if (!projectRoot) return;

    // [START] Queue while streaming — don't race the active turn. We
    // append to the queue and the drainer picks it up after _sendLoop
    // returns. Caller gets an immediate return so the input can clear.
    if (get().streaming) {
      set((s) => ({ queue: [...s.queue, trimmed] }));
      return;
    }
    // [END]

    // [START] Phase 8 C3 — clear stale todos when a fresh user turn starts.
    set({ todos: [] });
    // [END]

    // Persist user message
    const userMsg = await appendCodeMessage({
      session_id: sessionId,
      role: "user",
      content: trimmed,
    });
    set((s) => ({ messages: [...s.messages, userMsg] }));

    // Start streaming
    await _sendLoop(sessionId, modelRef, projectRoot, 0, []);

    // [START] Drain queue — send each queued message as its own turn.
    // We don't batch them into one wire so the user sees a clear
    // request/response rhythm in the timeline.
    let next = get().queue[0];
    while (next !== undefined && !get().streaming) {
      set((s) => ({ queue: s.queue.slice(1) }));
      const nextUserMsg = await appendCodeMessage({
        session_id: sessionId,
        role: "user",
        content: next,
      });
      set((s) => ({ messages: [...s.messages, nextUserMsg] }));
      await _sendLoop(sessionId, modelRef, projectRoot, 0, []);
      next = get().queue[0];
    }
    // [END]
  },
}));

// [START] _sendLoop — runs one stream + optional tool dispatch + recurse.
// Wire build and persistence stay here; hot loop lives in runStreamTurn.
// toolHistory accumulates tool-call fingerprints within a single user turn
// so we can detect a model spinning on the same call (see guard below).
async function _sendLoop(
  sessionId: string,
  modelRef: string,
  projectRoot: string,
  depth: number,
  toolHistory: string[],
): Promise<void> {
  // [START] Phase 8.4 B-track — surface MAX_TOOL_LOOPS hit instead of silent return.
  // The silent `return` hid this case: from the user's perspective the agent
  // just stopped mid-task with no explanation. Now we leave a visible notice
  // so the user knows the budget was hit (and can either type "continue" to
  // restart the loop or switch to a stronger model).
  if (depth >= MAX_TOOL_LOOPS) {
    try {
      const noticeMsg = await appendCodeMessage({
        session_id: sessionId,
        role: "assistant",
        content:
          `_tool loop budget exhausted (${MAX_TOOL_LOOPS} iterations). ` +
          `Type a new instruction to continue, or switch to a stronger code model._`,
      });
      useCodeAgentStore.setState((s) => ({ messages: [...s.messages, noticeMsg] }));
    } catch (e) {
      console.warn("[code_agent] failed to persist loop-budget notice", e);
    }
    useCodeAgentStore.setState({
      streaming: false,
      owlState: "idle",
      abortController: null,
    });
    return;
  }
  // [END]

  const abortController = new AbortController();
  useCodeAgentStore.setState({
    streaming: true,
    owlState: "thinking",
    error: null,
    abortController,
  });

  const ports = useSidecarStore.getState().status.ports;

  try {
    // [START] Build system prompt — project path + agent tools catalog,
    // plus a tool-mode reminder when the user is in plan/ask mode. Mirrors
    // chat.ts so toggling the mode actually changes behaviour in the
    // agent, not just in the main chat.
    const toolMode = useToolModeStore.getState().mode;
    // [START] Phase 8 C10 — inject the Monaco selection into the system
    // prompt when the user has one active. Saves the "the code I'm
    // highlighting" round-trip — the agent sees the snippet, its path,
    // and line range without the user having to paste it. Only added to
    // the very first turn of a request (depth 0); tool-loop recursions
    // inherit the selection from prior wire messages.
    const selection = useCodeEditorStore.getState().editorSelection;
    const selectionBlock =
      depth === 0 && selection && selection.text.length > 0
        ? [
            "<editor_selection>",
            `path: ${selection.path}`,
            `lines: ${selection.startLine}-${selection.endLine}`,
            "```",
            selection.text,
            "```",
            "</editor_selection>",
            "The user currently has the snippet above selected in Monaco. ",
            "When they say \"this code\", \"this function\", or similar, they mean that snippet.",
          ].join("\n")
        : null;
    // [END]
    const systemParts = [
      `You are a coding assistant. The user's project is at: ${projectRoot}`,
      buildAgentToolsPrompt(),
      // [START] Phase 8 — model-agnostic output discipline.
      // Every model we support (Qwen / DeepSeek / Llama / Gemma…) occasionally
      // leaks its reasoning into the visible answer as self-talk:
      //   "Okay, writing response…" / "Wait, I should check…" / "Let me think…"
      // The UI auto-wraps those into hidden <think> blocks, but the cleanest
      // fix is to stop the model from emitting them in the first place. This
      // block is prepended to every turn so the instructions carry across all
      // models — aligned with the OVO north-star of "a local Claude that works
      // with any model." Kept in English because most local models follow
      // English system directives more reliably than mixed-language ones.
      [
        "RESPONSE STYLE (strict):",
        "- Be concise and direct. Answer the user, do not narrate yourself.",
        "- Put ALL internal deliberation inside <think>…</think> tags.",
        "- Do NOT emit meta-commentary in plain prose:",
        "  \"Okay, ...\", \"Wait, ...\", \"Hmm, ...\", \"Actually, ...\",",
        "  \"Let me ...\", \"I should ...\", \"I'll ...\", \"Now, ...\", \"So, ...\",",
        "  \"The user ...\", \"Looking at ...\", \"Turn N: ...\", \"Model: ...\".",
        "- Never repeat the same sentence or paragraph. If the answer is long",
        "  enough to risk repetition, stop sooner.",
        "- For code, output clean markdown fences with a language tag.",
        "",
        "TOOL USE (strict):",
        "- Call each tool AT MOST ONCE per user request unless the user asks",
        "  for multiple distinct actions.",
        "- After a successful tool call, STOP and reply with a short confirmation.",
        "  Do NOT call the same tool again to verify or double-check.",
        "- If write_file returns { written: true }, the file is done. Move on.",
        "- Never call write_file with empty `content`. If you don't have",
        "  content ready, skip the call.",
      ].join("\n"),
      // [END]
    ];
    if (toolMode === "plan") {
      systemParts.push(
        "⚠️ PLAN MODE: Do NOT invoke tools or modify files. Describe the steps you would take as a bulleted plan. If a tool is needed, describe what you would call and why.",
      );
    } else if (toolMode === "ask") {
      systemParts.push(
        "⚠️ ASK MODE: A human approves each tool call before it runs. Keep tool calls minimal and explicit about why each one is needed.",
      );
    }
    if (selectionBlock) {
      systemParts.push(selectionBlock);
    }
    // [END]

    // Build wire messages — compact history so prefill stays bounded.
    // See compactWireBody for the budget rules. Without this, long IDE
    // sessions drive first-token latency to 60s+ and eventually blow the
    // model's context window.
    const msgs = useCodeAgentStore.getState().messages;
    const compacted = compactWireBody(
      msgs
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    );
    const wire: ChatWireMessage[] = [];
    wire.push({ role: "system", content: systemParts.join("\n\n") });
    for (const m of compacted) {
      const role: "system" | "user" | "assistant" =
        m.role === "tool_result" || m.role === "user"
          ? "user"
          : m.role === "assistant"
            ? "assistant"
            : "system";
      wire.push({ role, content: m.content });
    }

    // Placeholder assistant row — patched on every delta.
    const assistantMsg = await appendCodeMessage({
      session_id: sessionId,
      role: "assistant",
      content: "",
    });
    useCodeAgentStore.setState((s) => ({ messages: [...s.messages, assistantMsg] }));

    // Sampling — code agent uses global chat_settings only (no persona store).
    const cs = useChatSettingsStore.getState();
    const sampling: Parameters<typeof runStreamTurn>[0]["sampling"] = {};
    if (typeof cs.temperature === "number") sampling.temperature = cs.temperature;
    if (typeof cs.top_p === "number") sampling.top_p = cs.top_p;
    if (typeof cs.repetition_penalty === "number") sampling.repetition_penalty = cs.repetition_penalty;
    if (typeof cs.max_tokens === "number" && cs.max_tokens > 0) sampling.max_tokens = cs.max_tokens;

    // [START] Phase 8 — rAF-batched delta flush. The naive "setState on
    // every frame from streamChat" approach drives React into a death
    // spiral once the assistant answer passes a few KB: ReactMarkdown +
    // rehype-highlight re-parse the entire document per delta, making
    // setState O(n²) in answer length. We now snapshot the latest
    // accumulated text in a ref, schedule one flush per animation frame,
    // and let React re-render at most 60 times a second regardless of
    // how fast tokens arrive. Long responses stay live without freezing.
    let pendingText = "";
    let flushScheduled = false;
    const flushNow = () => {
      flushScheduled = false;
      const snapshot = pendingText;
      useCodeAgentStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: snapshot } : m,
        ),
      }));
    };
    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      requestAnimationFrame(flushNow);
    };
    // [END]

    const result = await runStreamTurn({
      model: modelRef,
      wire,
      sampling,
      ports,
      signal: abortController.signal,
      onDelta: (accumulated) => {
        pendingText = accumulated;
        scheduleFlush();
      },
      onFirstToken: () => {
        useCodeAgentStore.setState({ owlState: "typing" });
      },
      onOwlPhase: (phase) => {
        useCodeAgentStore.setState({ owlState: phase });
      },
    });

    // Final flush — guarantees the last delta is on screen even if the
    // rAF scheduler was pre-empted by the stream closing.
    pendingText = result.accumulated;
    flushNow();

    // [START] Phase 8 — persist final content to SQLite.
    // Previously only the empty placeholder row reached the DB, so closing
    // and reopening the app wiped every assistant turn. UPDATE once after
    // the stream settles (not per-delta) so we stay cheap but durable.
    try {
      await updateCodeMessageContent(assistantMsg.id, result.accumulated);
    } catch (e) {
      console.warn("[code_agent] failed to persist assistant content", e);
    }
    // [END]

    // Repetition bailout — leave a user-facing notice, skip tool dispatch.
    if (result.repetitionDetected) {
      const notice = `${result.accumulated}\n\n---\n\n_model hit a repetition loop — stream stopped_`;
      useCodeAgentStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: notice } : m,
        ),
      }));
      useCodeAgentStore.setState({ streaming: false, owlState: "idle", abortController: null });
      return;
    }

    // [START] Phase 8.4 B-track — first-token timeout bailout.
    // Sidecar never produced a delta within 5 min — genuine crash / wedge.
    // Normal cold loads of 14B/30B quants (~60-180s) no longer trip this;
    // if we hit it, the sidecar almost certainly needs a restart.
    if (result.firstTokenTimedOut) {
      const notice =
        `_sidecar did not respond within 5 minutes — no first token. ` +
        `The model may have failed to load or the sidecar crashed. ` +
        `Check the terminal running 'tauri dev' for errors and retry, ` +
        `or switch to a smaller model._`;
      useCodeAgentStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: notice } : m,
        ),
      }));
      try {
        await updateCodeMessageContent(assistantMsg.id, notice);
      } catch (e) {
        console.warn("[code_agent] failed to persist first-token-timeout notice", e);
      }
      useCodeAgentStore.setState({ streaming: false, owlState: "error", abortController: null });
      return;
    }
    // [END]

    // [START] Phase 8.4 B-track — stuck-stream bailout.
    // Watchdog tripped (no delta for 30s+ mid-stream). Surface the partial
    // text plus a clear notice so the user knows it wasn't their click and
    // can retry / switch models without restarting the app.
    if (result.stuckDetected) {
      const notice = `${result.accumulated}\n\n---\n\n_model went silent for 30s — stream auto-aborted. Retry or switch model._`;
      useCodeAgentStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: notice } : m,
        ),
      }));
      try {
        await updateCodeMessageContent(assistantMsg.id, notice);
      } catch (e) {
        console.warn("[code_agent] failed to persist stuck notice", e);
      }
      useCodeAgentStore.setState({ streaming: false, owlState: "idle", abortController: null });
      return;
    }
    // [END]

    // Tool call handling — strip the raw block from the visible text, dispatch,
    // persist the result, then recurse so the model can react.
    if (result.toolCall) {
      const call = result.toolCall;
      const visibleText = result.accumulated.replace(call.raw, "").trim();
      useCodeAgentStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: visibleText } : m,
        ),
      }));

      // [START] Phase 8 — duplicate-call guard.
      // Fingerprint this call and count how many times we've seen it this
      // turn. If the model is spinning on the same `(name, args)` pair we
      // feed it back a synthetic result that points out the loop and stops
      // recursing — this is what killed 요약.md (four write_files in a
      // row, the last one blank, silently overwriting the real content).
      const fingerprint = `${call.name}:${JSON.stringify(call.arguments)}`;
      const priorHits = toolHistory.filter((h) => h === fingerprint).length;
      if (priorHits >= DUPLICATE_LIMIT) {
        const notice = JSON.stringify({
          loop_broken: true,
          tool: call.name,
          message:
            "You already called this exact tool with the same arguments. " +
            "Stop re-invoking it and reply with a concise confirmation instead.",
        });
        const loopMsg = await appendCodeMessage({
          session_id: sessionId,
          role: "tool_result",
          content: `<tool_result>${notice}</tool_result>`,
        });
        useCodeAgentStore.setState((s) => ({ messages: [...s.messages, loopMsg] }));
        useCodeAgentStore.setState({
          streaming: false,
          owlState: "idle",
          abortController: null,
        });
        return;
      }
      const nextHistory = [...toolHistory, fingerprint];
      // [END]

      // [START] Phase 8.4 — plan-mode hard enforcement.
      // Previously plan mode only *asked* the model to skip tools via the
      // system prompt. A model that ignores the directive would happily
      // fire off a write_file and clobber the user's code. Now we
      // short-circuit BEFORE dispatch and feed a synthetic tool_result so
      // the model reads "your call would have gone through, but we're in
      // plan mode — describe the intent instead" and completes the turn
      // as a dry run.
      const currentMode = useToolModeStore.getState().mode;
      if (currentMode === "plan") {
        const planJson = JSON.stringify({
          plan_only: true,
          tool: call.name,
          args: call.arguments,
          message:
            "Plan mode is active — no tool was executed. Describe your intent, the exact call you'd make, and the expected outcome. The user will switch out of plan mode when ready.",
        });
        const planMsg = await appendCodeMessage({
          session_id: sessionId,
          role: "tool_result",
          content: `<tool_result>${planJson}</tool_result>`,
        });
        useCodeAgentStore.setState((s) => ({ messages: [...s.messages, planMsg] }));
        useCodeAgentStore.setState({
          streaming: false,
          owlState: "thinking",
          abortController: null,
        });
        await _sendLoop(sessionId, modelRef, projectRoot, depth + 1, nextHistory);
        return;
      }
      // [END]

      // [START] Phase 8 C2 — ask-mode approval gate.
      // Writable tools pause for the user to inspect the call args before
      // running. Reject path returns a structured error so the model can
      // react (retry, apologise, move on) instead of silently ignoring.
      const WRITABLE_TOOLS = new Set([
        "write_file",
        "edit_file",
        "create_file",
        "delete_file",
        "rename_file",
        "run_command",
      ]);
      if (currentMode === "ask" && WRITABLE_TOOLS.has(call.name)) {
        const approved = await useCodeAgentStore
          .getState()
          .requestApproval(call.name, call.arguments);
        if (!approved) {
          // [START] Phase 8.4 — reject scope + per-turn cap.
          // Prior message said "user rejected THIS action" which models
          // read as "try a different tool" (write_file → create_file →
          // write_file with slightly different args), turning one reject
          // into a cascade of approval modals. Tighten the feedback:
          //   - Name the *outcome* (path/command) the user refused, not
          //     just the tool.
          //   - Forbid retrying the same target with any other tool.
          //   - Count rejects this turn; bail out cleanly after 2 so the
          //     user isn't trapped in a reject loop.
          const rejectFingerprint = `__user_rejected__`;
          const priorRejects = toolHistory.filter((h) => h === rejectFingerprint).length;
          const targetHint = (() => {
            const args = call.arguments as Record<string, unknown> | undefined;
            const path =
              args && typeof args.path === "string" ? (args.path as string) : null;
            const command =
              args && typeof args.command === "string" ? (args.command as string) : null;
            const from = args && typeof args.from === "string" ? (args.from as string) : null;
            if (path) return `path "${path}"`;
            if (command) return `command "${command}"`;
            if (from) return `rename target "${from}"`;
            return `this ${call.name} call`;
          })();
          if (priorRejects >= 1) {
            const stopNotice =
              `_user rejected 2 consecutive tool actions — stopping this turn. ` +
              `Say what you'd like to try next or type a new instruction._`;
            useCodeAgentStore.setState((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: stopNotice } : m,
              ),
            }));
            try {
              await updateCodeMessageContent(assistantMsg.id, stopNotice);
            } catch (e) {
              console.warn("[code_agent] persist stop notice failed", e);
            }
            useCodeAgentStore.setState({
              streaming: false,
              owlState: "idle",
              abortController: null,
            });
            return;
          }
          const rejectedJson = JSON.stringify({
            rejected: true,
            tool: call.name,
            target: targetHint,
            message:
              `User REJECTED this action. They do not want ${targetHint} to change via ANY tool. ` +
              `Do NOT retry the same target with a different tool (write_file/create_file/edit_file/run_command all count). ` +
              `Either suggest an entirely different approach to the original request, or stop and ask the user what they actually want. ` +
              `If another reject follows, the turn auto-aborts.`,
          });
          const rejMsg = await appendCodeMessage({
            session_id: sessionId,
            role: "tool_result",
            content: `<tool_result>${rejectedJson}</tool_result>`,
          });
          useCodeAgentStore.setState((s) => ({ messages: [...s.messages, rejMsg] }));
          useCodeAgentStore.setState({
            streaming: false,
            owlState: "thinking",
            abortController: null,
          });
          await _sendLoop(
            sessionId,
            modelRef,
            projectRoot,
            depth + 1,
            [...toolHistory, rejectFingerprint],
          );
          return;
          // [END]
        }
      }
      // [END]

      let resultJson: string;
      try {
        const { result: toolResult, sideEffect } = await dispatchCodeAgentTool(
          call.name,
          call.arguments,
          projectRoot,
        );

        // [START] Phase 8.4 — post-write tsc verification.
        // When the dispatcher flags a .ts/.tsx file write, run tsc
        // synchronously and attach any errors in that file to the tool
        // result. The model sees them in its next turn and can fix the
        // bug without us having to wait for a separate `npm run build`
        // call from the agent — shortens the correction loop by 1-2
        // round trips per broken edit.
        let enrichedResult: unknown = toolResult;
        if (sideEffect.verifyTsFile) {
          try {
            const tsc = await runTscCheck(projectRoot, sideEffect.verifyTsFile);
            if (tsc.ran && tsc.errors.length > 0) {
              enrichedResult = {
                ...(typeof toolResult === "object" && toolResult !== null
                  ? (toolResult as Record<string, unknown>)
                  : { value: toolResult }),
                tsc_errors: tsc.errors,
                tsc_errors_truncated_from: tsc.errors_truncated_from,
                tsc_hint:
                  "These are TypeScript errors in the file you just wrote. " +
                  "Read them and fix with edit_file before moving on. " +
                  "Common causes: missing backticks around ${...} template literals, " +
                  "missing imports, wrong prop types.",
              };
            }
          } catch (e) {
            console.warn("[code_agent] tsc check failed", e);
          }
        }
        // [END]

        // [START] Phase 8.4 — auto-truncate oversized tool results before
        // they hit the wire. See truncateToolResult above for the rules.
        resultJson = JSON.stringify(truncateToolResult(enrichedResult));
        // [END]

        if (sideEffect.refreshTree) void useCodeEditorStore.getState().refreshTree();
        if (sideEffect.openFile) void useCodeEditorStore.getState().openFile(sideEffect.openFile);
        if (sideEffect.refreshGit) void useCodeGitStore.getState().refresh(projectRoot);
        // [START] Phase 8 C3 — pipe todo_write payload into the store.
        if (sideEffect.updateTodos) {
          useCodeAgentStore
            .getState()
            .setTodos(sideEffect.updateTodos as AgentTodoItem[]);
        }
        // [END]
      } catch (e) {
        resultJson = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }

      const toolResultMsg = await appendCodeMessage({
        session_id: sessionId,
        role: "tool_result",
        content: `<tool_result>${resultJson}</tool_result>`,
      });
      useCodeAgentStore.setState((s) => ({ messages: [...s.messages, toolResultMsg] }));

      useCodeAgentStore.setState({
        streaming: false,
        owlState: "thinking",
        abortController: null,
      });
      await _sendLoop(sessionId, modelRef, projectRoot, depth + 1, nextHistory);
      return;
    }

    // [START] Phase 8.4 B-track — malformed tool_use recovery.
    // The parser only succeeds on a complete `<tool_use>{...}</tool_use>`
    // block. When the model emits the opening tag but cuts off mid-JSON
    // (truncation, hit max_tokens, broken escape) we'd previously land in
    // the "Happy path" branch — turn ends, broken text leaks into chat,
    // user has to manually nudge ("그래", "ㄱㄱ") and the model regenerates
    // the same broken output. Mirror Claude Code: synthesize a tool_result
    // error so the model gets feedback inside the same turn, count it via
    // the duplicate guard so the loop short-circuits if the model can't
    // recover, and recurse.
    // Check all known tag variants so <tool_call> / <function_call> models
    // get the same recovery treatment as <tool_use>.
    // Two malformed patterns we need to catch:
    //   A) Unclosed: <tool_use>{... (stream ended mid-JSON, no </tool_use>)
    //   B) Closed but unparseable: <tool_use>{ invalid JSON }</tool_use>
    //      (model emitted both tags but JSON.parse / YAML fallback rejected
    //      the body — common when content strings contain unescaped chars
    //      or the model used template-literal syntax the parser can't read)
    // Without pattern B, the agent silently goes to Happy path after a
    // failed call — the file never gets written and the user sees the
    // tool_use block sitting in chat with no follow-up.
    let firstOpen = -1;
    for (const tag of TOOL_OPEN_TAGS) {
      const idx = result.accumulated.indexOf(tag);
      if (idx !== -1 && (firstOpen === -1 || idx < firstOpen)) firstOpen = idx;
    }
    let lastOpen = -1;
    for (const tag of TOOL_OPEN_TAGS) {
      const idx = result.accumulated.lastIndexOf(tag);
      if (idx > lastOpen) lastOpen = idx;
    }
    let lastClose = -1;
    for (const tag of TOOL_CLOSE_TAGS) {
      const idx = result.accumulated.lastIndexOf(tag);
      if (idx > lastClose) lastClose = idx;
    }
    const unclosedBlock = lastOpen !== -1 && lastOpen > lastClose;
    // Pattern B — opening tag exists but parser returned no toolCall and
    // the block appears closed (or there was at least one opening tag).
    // We already know result.toolCall is null at this point.
    const unparseableBlock = firstOpen !== -1 && !unclosedBlock;
    if (unclosedBlock || unparseableBlock) {
      // [START] Phase 8.4 — grammar-constrained regeneration rescue.
      // Before we fall back to the "tell the model it messed up" path,
      // try once to regenerate THIS tool call through the sidecar's
      // /ovo/tool_call endpoint, which runs the same model behind an
      // Outlines JSON-schema logits processor. The decoder cannot emit
      // invalid tokens — the output is guaranteed to be a parseable
      // tool call. If that succeeds we synthesize the same state we
      // would have had if the stream had produced a clean block.
      try {
        const countMsgs = compacted.map((m) => {
          const role: "system" | "user" | "assistant" =
            m.role === "tool_result"
              ? "user"
              : m.role === "assistant"
                ? "assistant"
                : m.role === "system"
                  ? "system"
                  : "user";
          return { role, content: m.content };
        });
        const toolSchemas = CODE_AGENT_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(t.parameters).map(([k, v]) => [
                k,
                { type: v.type, description: v.description },
              ]),
            ),
            required: Object.entries(t.parameters)
              .filter(([, v]) => v.required)
              .map(([k]) => k),
          },
        }));
        const constrained = await generateConstrainedToolCall(
          modelRef,
          countMsgs,
          toolSchemas,
          { max_tokens: 2048 },
          ports,
        );
        const rescuedCall = constrained.tool_call;
        if (rescuedCall && typeof rescuedCall.name === "string") {
          const synthRaw = `<tool_use>${JSON.stringify(rescuedCall)}</tool_use>`;
          const rescueNotice =
            `${result.accumulated}\n\n_malformed tool call rewritten via grammar-constrained regeneration:_\n${synthRaw}`;
          useCodeAgentStore.setState((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: rescueNotice } : m,
            ),
          }));
          try {
            await updateCodeMessageContent(assistantMsg.id, rescueNotice);
          } catch (e) {
            console.warn("[code_agent] failed to persist rescue notice", e);
          }
          // Dispatch the rescued call exactly like the in-stream happy path.
          const fingerprint = `${rescuedCall.name}:${JSON.stringify(rescuedCall.arguments ?? {})}`;
          let rescueResultJson: string;
          try {
            const { result: toolResult, sideEffect } = await dispatchCodeAgentTool(
              rescuedCall.name,
              (rescuedCall.arguments as Record<string, unknown>) ?? {},
              projectRoot,
            );
            let enriched: unknown = toolResult;
            if (sideEffect.verifyTsFile) {
              try {
                const tsc = await runTscCheck(projectRoot, sideEffect.verifyTsFile);
                if (tsc.ran && tsc.errors.length > 0) {
                  enriched = {
                    ...(typeof toolResult === "object" && toolResult !== null
                      ? (toolResult as Record<string, unknown>)
                      : { value: toolResult }),
                    tsc_errors: tsc.errors,
                    tsc_hint:
                      "TypeScript errors in the rescued file. Use edit_file to fix.",
                  };
                }
              } catch (e) {
                console.warn("[code_agent] rescue tsc check failed", e);
              }
            }
            rescueResultJson = JSON.stringify(truncateToolResult(enriched));
            if (sideEffect.refreshTree) void useCodeEditorStore.getState().refreshTree();
            if (sideEffect.openFile)
              void useCodeEditorStore.getState().openFile(sideEffect.openFile);
            if (sideEffect.refreshGit) void useCodeGitStore.getState().refresh(projectRoot);
            if (sideEffect.updateTodos) {
              useCodeAgentStore
                .getState()
                .setTodos(sideEffect.updateTodos as AgentTodoItem[]);
            }
          } catch (e) {
            rescueResultJson = JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            });
          }
          const rescueToolMsg = await appendCodeMessage({
            session_id: sessionId,
            role: "tool_result",
            content: `<tool_result>${rescueResultJson}</tool_result>`,
          });
          useCodeAgentStore.setState((s) => ({
            messages: [...s.messages, rescueToolMsg],
          }));
          useCodeAgentStore.setState({
            streaming: false,
            owlState: "thinking",
            abortController: null,
          });
          await _sendLoop(
            sessionId,
            modelRef,
            projectRoot,
            depth + 1,
            [...toolHistory, fingerprint],
          );
          return;
        }
      } catch (e) {
        console.warn(
          "[code_agent] grammar-constrained rescue unavailable, falling back to feedback:",
          e,
        );
      }
      // [END]
      const malformedFingerprint = "__malformed_tool_use__";
      const priorMalformed = toolHistory.filter((h) => h === malformedFingerprint).length;
      if (priorMalformed >= DUPLICATE_LIMIT) {
        const giveUpNotice =
          `${result.accumulated}\n\n---\n\n` +
          `_model emitted ${priorMalformed + 1} malformed tool calls in a row — stopping. ` +
          `Try a stronger code model (Qwen2.5-Coder-7B/14B) or simplify the request._`;
        useCodeAgentStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: giveUpNotice } : m,
          ),
        }));
        try {
          await updateCodeMessageContent(assistantMsg.id, giveUpNotice);
        } catch (e) {
          console.warn("[code_agent] failed to persist malformed give-up notice", e);
        }
        useCodeAgentStore.setState({
          streaming: false,
          owlState: "idle",
          abortController: null,
        });
        return;
      }
      const errorJson = JSON.stringify({
        error: "malformed_tool_use",
        reason: unclosedBlock ? "unclosed_block" : "unparseable_json",
        message: unclosedBlock
          ? "Your last tool call was not closed (no closing tag). " +
            "Re-emit the call as a single complete <tool_use>{...}</tool_use> block. " +
            "Tip: keep `content` arguments short — for files >50 lines, write a small placeholder first then use edit_file to fill in the rest."
          : "Your last tool call had a closing tag but the JSON inside could not be parsed. " +
            "Common causes: (1) unescaped newlines in string values — always use \\n, never raw newlines; " +
            "(2) unescaped double quotes inside strings — use \\\"; " +
            "(3) template-literal syntax (backticks / ${...}) — valid JSON strings do not use backticks. " +
            "Re-emit the call with strict JSON escaping.",
      });
      const errMsg = await appendCodeMessage({
        session_id: sessionId,
        role: "tool_result",
        content: `<tool_result>${errorJson}</tool_result>`,
      });
      useCodeAgentStore.setState((s) => ({ messages: [...s.messages, errMsg] }));
      useCodeAgentStore.setState({
        streaming: false,
        owlState: "thinking",
        abortController: null,
      });
      await _sendLoop(
        sessionId,
        modelRef,
        projectRoot,
        depth + 1,
        [...toolHistory, malformedFingerprint],
      );
      return;
    }
    // [END]

    // Happy path — owl waves, auto-reset to idle.
    useCodeAgentStore.setState({ streaming: false, owlState: "happy", abortController: null });
    setTimeout(() => {
      if (!useCodeAgentStore.getState().streaming) {
        useCodeAgentStore.setState({ owlState: "idle" });
      }
    }, 1800);
  } catch (e) {
    const aborted = abortController.signal.aborted;
    useCodeAgentStore.setState({
      streaming: false,
      abortController: null,
      owlState: aborted ? "idle" : "error",
      error: aborted ? null : e instanceof Error ? e.message : String(e),
    });
    if (!aborted) {
      setTimeout(() => {
        if (useCodeAgentStore.getState().owlState === "error") {
          useCodeAgentStore.setState({ owlState: "idle" });
        }
      }, 2400);
    }
  }
}
// [END] _sendLoop
// [END] Phase 8.3
