import i18n from "../i18n";
import { countTokens, summarize, listModels, type CountTokensMessage } from "./api";
import { listMessages } from "../db/sessions";
import { useSessionsStore } from "../store/sessions";
import { useToastsStore } from "../store/toasts";
import { useSidecarStore } from "../store/sidecar";
import { useChatSettingsStore } from "../store/chat_settings";
import { useModelOverridesStore } from "../store/model_overrides";
import { useFeatureFlagsStore } from "../store/feature_flags";
import { embedTexts, cosineSimilarity } from "./embeddings";
import type { Message, CompactStrategy, OvoModel } from "../types/ovo";

// [START] shouldCompact — pure predicate. Returns true only when strategy is
// "auto" AND usage has crossed the warn_threshold ceiling.
export function shouldCompact(
  usage: number,
  maxContext: number,
  warnThreshold: number,
  strategy: CompactStrategy,
): boolean {
  if (strategy !== "auto") return false;
  if (maxContext <= 0) return false;
  return usage / maxContext >= warnThreshold;
}
// [END]

// [START] pickCompactionSlice — pure selector.
// Returns the oldest ~50 % of non-system, non-summary, non-compacted messages
// starting from the first user message. The newest half is left live so the
// model retains immediate conversational context.
export function pickCompactionSlice(messages: Message[]): Message[] {
  const eligible = messages.filter(
    (m) => !m.compacted && m.role !== "system" && m.role !== "summary",
  );
  if (eligible.length < 2) return [];
  const sliceEnd = Math.floor(eligible.length / 2);
  return eligible.slice(0, sliceEnd);
}
// [END]

// [START] Phase 8 — Semantic compaction slice.
// Replaces the naive oldest-50 % selector with an embedding-aware one:
//   - relevance = cosine(message, anchor) where anchor = last user message text
//   - redundancy = max cosine(message, other-message) inside the conversation
//   - compactScore = (1 − relevance) + redundancy × 0.3
//     → high score = low relevance to current topic AND/OR redundant
// Picks highest-score messages until ~50 % of total chars compacted, then
// returns them in chronological order (so the resulting summary keeps a
// readable narrative).
//
// Always preserves the most recent two messages — the model still needs an
// immediate handle on the latest turn even if their score happens to qualify.
//
// Falls back to `pickCompactionSlice` when:
//   • fewer than 4 eligible messages
//   • no anchor text
//   • the embedding sidecar is unavailable (returns null)
//   • the embedding API returns a partial / mismatched result
const SEMANTIC_REDUNDANCY_WEIGHT = 0.3;
const SEMANTIC_MIN_ELIGIBLE = 4;
const SEMANTIC_TARGET_FRACTION = 0.5;

function messageText(m: Message): string {
  // Message.content is string per types/ovo.ts; keep guard for safety.
  return typeof m.content === "string" ? m.content : String(m.content ?? "");
}

export async function pickSemanticCompactionSlice(
  messages: Message[],
  anchorText: string,
): Promise<Message[]> {
  const eligible = messages.filter(
    (m) => !m.compacted && m.role !== "system" && m.role !== "summary",
  );
  if (eligible.length < SEMANTIC_MIN_ELIGIBLE) return pickCompactionSlice(messages);
  const anchor = anchorText.trim();
  if (!anchor) return pickCompactionSlice(messages);

  const texts = eligible.map(messageText);
  const allTexts = [anchor, ...texts];

  let result;
  try {
    result = await embedTexts(allTexts);
  } catch {
    return pickCompactionSlice(messages);
  }
  if (!result || result.embeddings.length !== allTexts.length) {
    return pickCompactionSlice(messages);
  }

  const anchorVec = result.embeddings[0];
  const msgVecs = result.embeddings.slice(1);

  const scored = eligible.map((m, i) => {
    const vec = msgVecs[i];
    const relevance = cosineSimilarity(anchorVec, vec);
    let maxOther = 0;
    for (let j = 0; j < msgVecs.length; j++) {
      if (j === i) continue;
      const sim = cosineSimilarity(vec, msgVecs[j]);
      if (sim > maxOther) maxOther = sim;
    }
    return {
      msg: m,
      score: 1 - relevance + maxOther * SEMANTIC_REDUNDANCY_WEIGHT,
      length: texts[i].length,
    };
  });

  const totalLen = scored.reduce((s, x) => s + x.length, 0);
  const target = totalLen * SEMANTIC_TARGET_FRACTION;
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  const picked = new Set<string>();
  let acc = 0;
  for (const x of sorted) {
    if (acc >= target && picked.size >= 2) break;
    picked.add(x.msg.id);
    acc += x.length;
  }

  // Always preserve the two most recent eligible messages
  const recent = eligible.slice(-2);
  for (const r of recent) picked.delete(r.id);

  if (picked.size === 0) return pickCompactionSlice(messages);
  return eligible.filter((m) => picked.has(m.id));
}
// [END]

// [START] runCompact — async, idempotent via `compacting` flag.
// Folds the oldest ~50 % of live messages into a summary message then marks
// the originals as compacted. Re-counts tokens after the operation and
// updates context_tokens on the session.
export async function runCompact(
  sessionId: string,
  opts: { strategy?: "auto" | "manual" } = {},
): Promise<{ ok: true; freed: number } | { ok: false; reason: string }> {
  const sessionsStore = useSessionsStore.getState();
  const toasts = useToastsStore.getState();
  const ports = useSidecarStore.getState().status.ports;

  const session = sessionsStore.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, reason: "session not found" };
  if (session.compacting) return { ok: false, reason: "already compacting" };

  const modelRef = session.model_ref;
  if (!modelRef) return { ok: false, reason: "no model set on session" };

  // [START] set compacting flag — UI disables ChatInput while this runs
  await sessionsStore.setSessionCompacting(sessionId, true);
  // [END]

  try {
    // Load ALL messages (including already-compacted) to find the live slice.
    const allMessages = await listMessages(sessionId);
    const liveMessages = allMessages.filter((m) => !m.compacted);

    // [START] Phase 8 — semantic slice when flag on, else legacy oldest-50 %
    const useSemantic = useFeatureFlagsStore.getState().enable_semantic_compact;
    let slice: Message[];
    if (useSemantic) {
      const lastUser = [...liveMessages]
        .reverse()
        .find((m) => m.role === "user");
      const anchor = lastUser ? messageText(lastUser) : "";
      slice = await pickSemanticCompactionSlice(liveMessages, anchor);
    } else {
      slice = pickCompactionSlice(liveMessages);
    }
    if (slice.length === 0) {
      return { ok: false, reason: "nothing to compact" };
    }
    // [END]

    // Build wire format for summarize — drop attachments (image blobs can't be summarized).
    const wireMessages: CountTokensMessage[] = slice.map((m) => ({
      role: m.role === "summary" ? "assistant" : (m.role as "user" | "assistant" | "system"),
      content: m.content,
    }));

    const oldTokens = session.context_tokens;

    // Call sidecar summarize endpoint.
    const result = await summarize(modelRef, wireMessages, {}, ports);

    // [START] Insert summary BEFORE marking originals compacted — order matters.
    // If we marked first, a crash would leave messages compacted with no summary.
    await sessionsStore.appendMessage({
      session_id: sessionId,
      role: "summary",
      content: result.summary,
    });

    await sessionsStore.markMessagesCompacted(slice.map((m) => m.id));
    // [END]

    // Re-count tokens with the new live message list.
    const updatedLive = await listMessages(sessionId);
    const newLiveMessages = updatedLive.filter((m) => !m.compacted);
    const newTokenWire: CountTokensMessage[] = newLiveMessages.map((m) => ({
      role: m.role === "summary" ? "system" : (m.role as "user" | "assistant" | "system"),
      content: m.content,
    }));

    let newTokens = oldTokens;
    try {
      newTokens = await countTokens(modelRef, newTokenWire, ports);
      await sessionsStore.setSessionContextTokens(sessionId, newTokens);
    } catch {
      // token recount failure is non-fatal — compact already succeeded
    }

    const freed = Math.max(0, oldTokens - newTokens);
    const freedPct = oldTokens > 0 ? Math.round((freed / oldTokens) * 100) : 0;

    const strategy = opts.strategy ?? "auto";
    if (strategy === "auto") {
      toasts.push({
        kind: "success",
        message: i18n.t("compact.toasts.auto_success", { freed: freedPct }),
      });
    } else {
      toasts.push({
        kind: "success",
        message: i18n.t("compact.toasts.manual_success"),
      });
    }

    return { ok: true, freed };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    toasts.push({
      kind: "error",
      message: i18n.t("compact.toasts.error", { error: reason }),
    });
    return { ok: false, reason };
  } finally {
    // Always reset compacting flag — even on failure.
    await useSessionsStore.getState().setSessionCompacting(sessionId, false);
  }
}
// [END]

// [START] Model cache — populated once per process lifetime on first call to
// ensureModelCache(). Keyed by repo_id. Avoids repeated sidecar round-trips.
const FALLBACK_MAX_CONTEXT = 8192;
let _modelCache: Map<string, OvoModel> | null = null;

async function ensureModelCache(): Promise<Map<string, OvoModel>> {
  if (_modelCache) return _modelCache;
  try {
    const ports = useSidecarStore.getState().status.ports;
    const res = await listModels(ports);
    const map = new Map<string, OvoModel>();
    for (const m of res.models) map.set(m.repo_id, m);
    _modelCache = map;
  } catch {
    _modelCache = new Map();
  }
  return _modelCache;
}

/** Exported so tests / ContextIndicator can bust the cache when sidecar restarts. */
export function bustModelCache(): void {
  _modelCache = null;
}

/**
 * Resolves the effective max_context for a model:
 *   1. DB override.max_context (if exists)
 *   2. model.max_context from sidecar list
 *   3. FALLBACK_MAX_CONTEXT (8192)
 */
export async function resolveMaxContext(modelRef: string | null): Promise<number> {
  if (!modelRef) return FALLBACK_MAX_CONTEXT;
  const override = useModelOverridesStore.getState().getOverride(modelRef);
  if (override) return override.max_context;
  const cache = await ensureModelCache();
  const model = cache.get(modelRef);
  return model?.max_context ?? FALLBACK_MAX_CONTEXT;
}

/**
 * Resolves the effective warn_threshold for a model (0–1):
 *   1. DB override.warn_threshold (if exists)
 *   2. global_warn_threshold from ChatSettings store
 *   3. 0.75 literal fallback
 */
export function resolveWarnThreshold(modelRef: string | null): number {
  if (modelRef) {
    const override = useModelOverridesStore.getState().getOverride(modelRef);
    if (override) return override.warn_threshold;
  }
  return useChatSettingsStore.getState().global_warn_threshold;
}
// [END]

// [START] maybeAutoCompact — called after every stream end (non-blocking).
// Checks context usage against the resolved warn_threshold; if "auto" strategy
// and threshold crossed, fires runCompact. Otherwise noop.
export async function maybeAutoCompact(sessionId: string): Promise<void> {
  const session = useSessionsStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  if (!session) return;

  const maxContext = await resolveMaxContext(session.model_ref);
  const warnThreshold = resolveWarnThreshold(session.model_ref);

  if (
    shouldCompact(
      session.context_tokens,
      maxContext,
      warnThreshold,
      session.compact_strategy,
    )
  ) {
    await runCompact(sessionId, { strategy: "auto" });
  }
}
// [END]
