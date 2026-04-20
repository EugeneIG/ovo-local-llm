import { createWikiPage } from "../db/wiki";
import { listLiveMessages } from "../db/sessions";
import { useFeatureFlagsStore } from "../store/feature_flags";
import { useProjectContextStore } from "../store/project_context";

// [START] Phase 8 — Wiki auto-capture.
// When a chat session is left (selectSession to a different id) or deleted,
// dump a compact summary into the Wiki under category 'session-log' so the
// project memory grows organically. Gated by `enable_wiki_auto_capture` so
// users opt in.
//
// MVP heuristic for "meaningful":
//   - At least one user message + at least one assistant message
//   - Not already captured (localStorage marker keyed by session id)
//
// Smarter LLM-based summarization can swap in later by replacing the
// formatSession() body. Stays purely local for now to avoid waking the
// sidecar on session teardown.

const MARKER_PREFIX = "ovo:auto_captured:";

function isCaptured(sessionId: string): boolean {
  try {
    return localStorage.getItem(MARKER_PREFIX + sessionId) === "1";
  } catch {
    return false;
  }
}

function markCaptured(sessionId: string): void {
  try {
    localStorage.setItem(MARKER_PREFIX + sessionId, "1");
  } catch {
    /* ignore */
  }
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(content);
}

function kstNow(): string {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface AutoCaptureInput {
  sessionId: string;
  sessionTitle?: string | null;
  modelRef?: string | null;
}

export async function autoCaptureSession(input: AutoCaptureInput): Promise<void> {
  const flags = useFeatureFlagsStore.getState();
  if (!flags.enable_wiki_auto_capture) return;
  if (isCaptured(input.sessionId)) return;

  let messages;
  try {
    messages = await listLiveMessages(input.sessionId);
  } catch {
    return;
  }
  if (!messages || messages.length < 2) return;

  const firstUser = messages.find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!firstUser || !lastAssistant) return;

  const userText = asText(firstUser.content).trim();
  const asstText = asText(lastAssistant.content).trim();
  if (!userText || !asstText) return;

  const titleSeed = (input.sessionTitle ?? userText).trim();
  const title = `[세션] ${titleSeed.slice(0, 60)}`.replace(/\s+/g, " ");

  const body = [
    "> 자동 캡처된 세션 요약 — 필요 없으면 아카이브하거나 삭제해도 돼.",
    "",
    `**모델**: ${input.modelRef ?? "unknown"}`,
    `**캡처 시각**: ${kstNow()}`,
    `**세션 ID**: \`${input.sessionId}\``,
    "",
    "## 첫 질문",
    "",
    userText.slice(0, 1200),
    "",
    "## 마지막 답변",
    "",
    asstText.slice(0, 2400),
  ].join("\n");

  try {
    await createWikiPage({
      title,
      content: body,
      tier: "note",
      category: "session-log",
      tags: ["session-log", input.sessionId],
      project_path: useProjectContextStore.getState().project_path,
    });
    markCaptured(input.sessionId);
  } catch (e) {
    // Best-effort; don't block session teardown
    console.warn("autoCaptureSession failed", e);
  }
}
// [END] Phase 8
