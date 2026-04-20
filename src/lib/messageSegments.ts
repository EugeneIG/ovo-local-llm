// [START] Phase 8 — Message segment parser.
// Pure-logic extraction from ChatMessageBubble so the Code AgentChat can
// render the same `<think>`, `<tool_use>`, `<tool_result>` structure without
// duplicating the normalization rules. ChatMessageBubble will migrate to
// these exports in a follow-up (A3/B1-bis) — for now it keeps its own copies
// so this module stays a pure addition with zero regression risk.

import { parseToolUseBlock } from "./toolUse";

export type Segment =
  | { type: "text"; content: string }
  | { type: "think"; content: string; open: boolean }
  | { type: "tool_use"; name: string; argsJson: string }
  | { type: "tool_result"; content: string }
  // [START] Phase 5 — compact attachment chip row rendered above the text.
  // Replaces the raw `<attached_files>` XML block the composer appends to
  // the user message so the bubble shows a clean chip line instead of
  // leaky prompt plumbing.
  | { type: "attached_files"; paths: string[] };
  // [END]

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";
const TOOL_USE_OPEN = "<tool_use>";
const TOOL_USE_CLOSE = "</tool_use>";
const TOOL_RESULT_OPEN = "<tool_result>";
const TOOL_RESULT_CLOSE = "</tool_result>";

// [START] normalizeReasoning — rewrite Harmony/ChatML/bracket reasoning
// markers into the canonical `<think>…</think>` form so downstream segment
// parsing only needs to handle one dialect. Streaming partial markers (no
// terminator yet) also collapse to `<think>` so the open-reasoning state
// shows up immediately in the UI.
export function normalizeReasoning(input: string): string {
  let s = input;

  // Complete Harmony reasoning channels → <think>..</think>
  s = s.replace(
    /<\|channel\|>(?:analysis|thought|commentary)(?:<\|constrain\|>[^<]*)?<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|return\|>)/g,
    (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
  );
  // Complete Harmony final/response channel → strip wrapper, keep body as text
  s = s.replace(
    /<\|channel\|>(?:final|response)(?:<\|constrain\|>[^<]*)?<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|return\|>)/g,
    (_m, body: string) => body,
  );
  // Streaming Harmony reasoning open-only (no terminator yet)
  s = s.replace(
    /<\|channel\|>(?:analysis|thought|commentary)(?:<\|constrain\|>[^<]*)?<\|message\|>/g,
    OPEN_TAG,
  );
  // Streaming Harmony final open-only → drop wrapper
  s = s.replace(
    /<\|channel\|>(?:final|response)(?:<\|constrain\|>[^<]*)?<\|message\|>/g,
    "",
  );

  // ChatML think turn → <think>..</think>
  s = s.replace(
    /<\|im_start\|>(?:think|reasoning|analysis|assistant_thought)\s*\n?([\s\S]*?)<\|im_end\|>/g,
    (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
  );
  s = s.replace(
    /<\|im_start\|>(?:think|reasoning|analysis|assistant_thought)\s*\n?/g,
    OPEN_TAG,
  );

  // Alt HTML-ish tag pairs → <think>..</think>
  const altPairs: Array<[string, string]> = [
    ["thinking", "thinking"],
    ["reasoning", "reasoning"],
    ["reflection", "reflection"],
    ["scratchpad", "scratchpad"],
  ];
  for (const [open, close] of altPairs) {
    s = s.replace(
      new RegExp(`<${open}>([\\s\\S]*?)</${close}>`, "g"),
      (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
    );
    s = s.replace(new RegExp(`<${open}>`, "g"), OPEN_TAG);
  }

  // Bracket reasoning variants
  const brackets = ["THOUGHT", "THINK", "REASONING"];
  for (const name of brackets) {
    s = s.replace(
      new RegExp(`\\[${name}\\]([\\s\\S]*?)\\[/${name}\\]`, "g"),
      (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
    );
    s = s.replace(new RegExp(`\\[${name}\\]`, "g"), OPEN_TAG);
    s = s.replace(new RegExp(`\\[/${name}\\]`, "g"), CLOSE_TAG);
  }

  // Loose Harmony/ChatML meta tokens that slipped through.
  s = s.replace(
    /<\|(?:start|end|return|message|channel|constrain|\/constrain|im_start|im_end)\|>/g,
    "",
  );

  return s;
}
// [END]

function skipLeadingWs(s: string, from: number): number {
  let j = from;
  while (j < s.length) {
    const c = s[j];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") j++;
    else break;
  }
  return j;
}

// [START] parseSegments — scan normalized content for the nearest special
// block (think / tool_use / tool_result) and emit a sequence of segments.
// Unterminated blocks mid-stream are left "open" so the UI can show a
// spinner / streaming state. Empty text slots are dropped at the end so the
// caller doesn't have to guard against them.
export function parseSegments(raw: string): Segment[] {
  // [START] Phase 5 — strip the `<attached_files>…</attached_files>` block
  // the composer appends when the user attaches files. The raw text still
  // reaches the model (full fidelity) but the bubble renders a tidy
  // "attached_files" segment instead of leaking the XML wrapper.
  let pre = raw;
  const atOpen = "<attached_files>";
  const atClose = "</attached_files>";
  const attachedOut: Segment[] = [];
  while (true) {
    const oi = pre.indexOf(atOpen);
    if (oi === -1) break;
    const ci = pre.indexOf(atClose, oi + atOpen.length);
    if (ci === -1) break;
    const body = pre.slice(oi + atOpen.length, ci);
    // Each line is "- /abs/path" (matches AgentChat's composer build).
    const paths = body
      .split("\n")
      .map((l) => l.trim().replace(/^-\s*/, ""))
      .filter((l) => l.length > 0);
    if (paths.length > 0) {
      attachedOut.push({ type: "attached_files", paths });
    }
    // Remove the block and collapse the blank gap the composer left ahead
    // of it so the surrounding text stays pretty.
    pre = (pre.slice(0, oi) + pre.slice(ci + atClose.length)).replace(/\n{3,}/g, "\n\n").trim();
  }
  // [END]
  const content = normalizeReasoning(pre);
  const out: Segment[] = attachedOut.slice();
  let i = 0;

  // Implicit-open: R1-style templates inject <think> server-side, so the
  // stream can start with reasoning content that terminates at </think>.
  const firstOpen = content.indexOf(OPEN_TAG);
  const firstClose = content.indexOf(CLOSE_TAG);
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    const prefix = content.slice(0, firstClose).trim();
    out.push({ type: "think", content: prefix, open: false });
    i = skipLeadingWs(content, firstClose + CLOSE_TAG.length);
  }

  while (i < content.length) {
    const nextThink = content.indexOf(OPEN_TAG, i);
    const nextToolUse = content.indexOf(TOOL_USE_OPEN, i);
    const nextToolResult = content.indexOf(TOOL_RESULT_OPEN, i);

    const candidates: Array<[number, string]> = [
      [nextThink === -1 ? Infinity : nextThink, "think"],
      [nextToolUse === -1 ? Infinity : nextToolUse, "tool_use"],
      [nextToolResult === -1 ? Infinity : nextToolResult, "tool_result"],
    ];
    candidates.sort((a, b) => a[0] - b[0]);
    const [nearestIdx, nearestKind] = candidates[0];

    if (nearestIdx === Infinity) {
      out.push({ type: "text", content: content.slice(i) });
      break;
    }

    if (nearestIdx > i) {
      out.push({ type: "text", content: content.slice(i, nearestIdx) });
    }

    if (nearestKind === "think") {
      const afterOpen = nearestIdx + OPEN_TAG.length;
      const closeIdx = content.indexOf(CLOSE_TAG, afterOpen);
      if (closeIdx === -1) {
        out.push({ type: "think", content: content.slice(afterOpen), open: true });
        return out.filter((s) => !(s.type === "text" && s.content.length === 0));
      }
      out.push({ type: "think", content: content.slice(afterOpen, closeIdx), open: false });
      i = skipLeadingWs(content, closeIdx + CLOSE_TAG.length);
    } else if (nearestKind === "tool_use") {
      const afterOpen = nearestIdx + TOOL_USE_OPEN.length;
      const closeIdx = content.indexOf(TOOL_USE_CLOSE, afterOpen);
      if (closeIdx === -1) {
        out.push({ type: "text", content: content.slice(nearestIdx) });
        break;
      }
      const parsed = parseToolUseBlock(content.slice(nearestIdx));
      if (parsed !== null) {
        out.push({
          type: "tool_use",
          name: parsed.name,
          argsJson: JSON.stringify(parsed.arguments, null, 2),
        });
      } else {
        out.push({
          type: "text",
          content: content.slice(nearestIdx, closeIdx + TOOL_USE_CLOSE.length),
        });
      }
      i = skipLeadingWs(content, closeIdx + TOOL_USE_CLOSE.length);
    } else {
      const afterOpen = nearestIdx + TOOL_RESULT_OPEN.length;
      const closeIdx = content.indexOf(TOOL_RESULT_CLOSE, afterOpen);
      if (closeIdx === -1) {
        out.push({ type: "text", content: content.slice(nearestIdx) });
        break;
      }
      out.push({
        type: "tool_result",
        content: content.slice(afterOpen, closeIdx).trim(),
      });
      i = skipLeadingWs(content, closeIdx + TOOL_RESULT_CLOSE.length);
    }
  }
  // [START] Phase 8.4 — strip orphan tool tags from text segments.
  // Models occasionally emit an unmatched </tool_use> after a successful
  // block, or leave tool_call variants behind when we aliased them mid-
  // parse. These bare tags are pure noise to the user. Scrub them here so
  // they never reach the bubble renderer.
  const cleaned = out.map((s): Segment => {
    if (s.type !== "text") return s;
    const scrubbed = s.content
      .replace(/<\/?tool_use>/g, "")
      .replace(/<\/?tool_call>/g, "")
      .replace(/<\/?function_call>/g, "")
      .replace(/<\/?tool_result>/g, "");
    return { type: "text", content: scrubbed };
  });
  // [START] Phase 5 — "answer trapped in <think>" rescue.
  // Vision models (notably Gemma-3, some VL variants) occasionally wrap
  // the entire final answer inside a single <think> block and never emit
  // a plain-text answer. Without intervention the bubble renders only a
  // collapsed "생각" group and the user sees nothing unless they expand.
  // When a message has no text / tool segments AND at least one think
  // segment, promote the think content to text so the answer is visible.
  // Normal think+answer flows (which always have a text segment) are
  // untouched.
  const hasAnswerContent = cleaned.some(
    (s) =>
      (s.type === "text" && s.content.trim().length > 0) ||
      s.type === "tool_use" ||
      s.type === "tool_result" ||
      s.type === "attached_files",
  );
  const rescued: Segment[] = hasAnswerContent
    ? cleaned
    : cleaned.map((s): Segment => {
        if (s.type === "think" && s.content.trim().length > 0) {
          return { type: "text", content: s.content };
        }
        return s;
      });
  // [END]
  return hideSelfTalk(rescued.filter((s) => !(s.type === "text" && s.content.trim().length === 0)));
}
// [END]

// [START] hideSelfTalk — UI-side safety net for models that leak their
// reasoning into the visible answer without a <think> tag. We scan every
// `text` segment line-by-line for the canonical English self-talk openers
// ("Okay,", "Wait,", "Hmm,", "Actually,", "Let me ...", "I should ...",
// etc.). Consecutive self-talk lines collapse into a single hidden think
// block; ordinary prose passes through unchanged. This complements the
// system-prompt directive we send to every turn — the prompt stops *most*
// leaks and this parser catches whatever slips through, so no matter what
// model the user loads the agent chat stays readable.
const SELF_TALK_STARTERS: ReadonlyArray<RegExp> = [
  // Conversational openers.
  /^Okay[,.]?\s/i,
  /^Ok[,.]?\s/i,
  /^Alright[,.]?\s/i,
  /^Wait[,.]?\s/i,
  /^Hmm[,.]?\s/i,
  /^Hmmm[,.]?\s/i,
  /^Actually[,.]?\s/i,
  /^So[,.]?\s/i,
  /^Now[,.]?\s/i,
  /^Well[,.]?\s/i,
  /^Right[,.]?\s/i,
  /^Ah[,.]?\s/i,
  /^Oh[,.]?\s/i,
  // First-person deliberation.
  /^Let me\s/i,
  /^Let's\s/i,
  /^I (?:should|think|need|will|'ll|'m going to|'m gonna|want to|can|have to|guess|suppose|believe|realize|notice|see|wonder|understand|know)\s/i,
  /^Maybe (?:I|we)\s/i,
  /^First,?\s+(?:I|let)/i,
  // [START] Phase 8 — chain-of-thought debug noise. These are the patterns
  // that escaped Qwen3.6's think-tag discipline in the 요약.md repro:
  //   "The user wants me to…", "Turn 13: User …", "Looking at the history…"
  // They're never legitimate answer content, only trace-dump reasoning, so
  // we treat them as self-talk and hide them behind the think disclosure.
  /^The user\s/i,
  /^The model\s/i,
  /^The assistant\s/i,
  // [START] Phase 5 — document-analysis self-talk. Vision / long-context
  // models (Gemma-3 family, Qwen3 when loaded without their think template)
  // stream analysis notes as plain prose. Common openers:
  //   "The document covers:", "This PDF is about …", "Page 3: Jupiter …"
  // Catching them here keeps the bubble showing the model's actual answer.
  /^The (?:document|file|pdf|text|report|attachment|article|passage|input|content|image|screenshot)\s/i,
  /^This (?:document|file|pdf|text|report|attachment|article|passage|input|content|image|screenshot)\s/i,
  /^Page \d+[:.,]/i,
  /^Section \d+[:.,]/i,
  /^I'll (?:start|first|begin|need|use|search|check|look|try|see|read|analyze|summarize|call)\s/i,
  /^I'm (?:going|about|trying|looking|searching|analyzing|checking|reading)\s/i,
  // [END]
  /^User:\s/i,
  /^Model:\s/i,
  /^Assistant:\s/i,
  /^Turn \d+[:.]?\s/i,
  /^Looking at\s/i,
  /^It seems\s/i,
  /^It looks like\s/i,
  /^Perhaps\s/i,
  /^But maybe\s/i,
  /^Or perhaps\s/i,
  /^However,?\s+(?:the|I|we|it|maybe)/i,
  /^But (?:the|I|we|maybe)\s/i,
  // [END]
  // Korean self-talk filler patterns — strip them when the model starts replies.
  /^음[,…]/,
  /^어[,…]/,
  /^잠깐[,…]/,
  /^그럼[,…]\s*/,
  // [START] Phase 5 — 중국어 self-talk (Gemma 등 다국어 모델이 한글 문맥에서
  // 무의식적으로 튀어나오는 내적 독백). "我..." 로 시작하는 1인칭 사고
  // 문장과 자주 쓰이는 담론 연결어를 감지.
  /^我(?:应该|需要|想|可以|将|会|觉得|认为|要|得|来|先)/,
  /^搜索结果/,
  /^搜索(?:显示|发现|表明)/,
  /^看(?:来|起来|样子)/,
  /^同时[,，]/,
  /^最终[,，]/,
  /^另外[,，]/,
  /^然后[,，]/,
  /^不过[,，]/,
  /^但是[,，]/,
  // [END]
];

function isSelfTalkLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  // Defensive: very short self-talk fragments ("ok.", "wait!") are common
  // during streaming — treat as prose so we don't chop up legitimate words
  // like "Let's go build it!". A line must have at least three words to
  // qualify so the patterns don't hide short legitimate sentences.
  // CJK scripts don't use whitespace the same way, so we fall back to
  // character count (>=6) for those — catches "我应该告知..." but not
  // a bare "我好."
  const wordCount = t.split(/\s+/).length;
  const isCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(t);
  if (isCjk) {
    if (t.length < 6) return false;
  } else if (wordCount < 3) {
    return false;
  }
  return SELF_TALK_STARTERS.some((re) => re.test(t));
}

function hideSelfTalk(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.type !== "text") {
      out.push(seg);
      continue;
    }
    const lines = seg.content.split("\n");
    let pendingProse: string[] = [];
    let pendingSelfTalk: string[] = [];

    const flushProse = () => {
      if (pendingProse.length === 0) return;
      const joined = pendingProse.join("\n");
      if (joined.trim().length > 0) {
        out.push({ type: "text", content: joined });
      }
      pendingProse = [];
    };
    const flushSelfTalk = () => {
      if (pendingSelfTalk.length === 0) return;
      const joined = pendingSelfTalk.join("\n").trim();
      if (joined.length > 0) {
        out.push({ type: "think", content: joined, open: false });
      }
      pendingSelfTalk = [];
    };

    for (const line of lines) {
      if (isSelfTalkLine(line)) {
        flushProse();
        pendingSelfTalk.push(line);
      } else {
        flushSelfTalk();
        pendingProse.push(line);
      }
    }
    flushSelfTalk();
    flushProse();
  }
  return out;
}
// [END]
// [END] Phase 8
