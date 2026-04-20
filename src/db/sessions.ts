import { getDb, newId, nowMs } from "./index";
import type {
  ChatAttachment,
  CompactStrategy,
  Message,
  MessageRole,
  Session,
} from "../types/ovo";
// [START] Phase A — delete propagation helpers
import { deleteAttachment } from "../lib/attachmentStorage";
// [END]

// [START] DB row shapes — SQLite returns INTEGER for booleans. We normalize
// to real booleans at this boundary so the rest of the app deals with typed
// domain objects instead of 0/1 littering every component.
interface SessionRow {
  id: string;
  title: string;
  model_ref: string | null;
  system_prompt: string | null;
  compact_strategy: CompactStrategy;
  pinned: number;
  context_tokens: number;
  compacting: number;
  parent_session_id: string | null;
  parent_message_id: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  attachments_json: string | null;
  prompt_tokens: number | null;
  generation_tokens: number | null;
  compacted: number;
  created_at: number;
}

function parseAttachments(json: string | null): ChatAttachment[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ChatAttachment[]) : null;
  } catch {
    return null;
  }
}

function rowToSession(r: SessionRow): Session {
  return {
    id: r.id,
    title: r.title,
    model_ref: r.model_ref,
    system_prompt: r.system_prompt,
    compact_strategy: r.compact_strategy,
    pinned: r.pinned === 1,
    context_tokens: r.context_tokens,
    compacting: r.compacting === 1,
    parent_session_id: r.parent_session_id ?? null,
    parent_message_id: r.parent_message_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToMessage(r: MessageRow): Message {
  return {
    id: r.id,
    session_id: r.session_id,
    role: r.role,
    content: r.content,
    attachments: parseAttachments(r.attachments_json),
    prompt_tokens: r.prompt_tokens,
    generation_tokens: r.generation_tokens,
    compacted: r.compacted === 1,
    created_at: r.created_at,
  };
}
// [END]

// --- Sessions CRUD -----------------------------------------------------------

export interface CreateSessionInput {
  title?: string;
  model_ref?: string | null;
  system_prompt?: string | null;
  compact_strategy?: CompactStrategy;
  // [START] Phase 8 — fork lineage (set by forkSession; manual callers leave undefined)
  parent_session_id?: string | null;
  parent_message_id?: string | null;
  // [END]
}

export async function createSession(input: CreateSessionInput = {}): Promise<Session> {
  const db = await getDb();
  const now = nowMs();
  const session: Session = {
    id: newId(),
    title: input.title ?? "",
    model_ref: input.model_ref ?? null,
    system_prompt: input.system_prompt ?? null,
    compact_strategy: input.compact_strategy ?? "auto",
    pinned: false,
    context_tokens: 0,
    compacting: false,
    parent_session_id: input.parent_session_id ?? null,
    parent_message_id: input.parent_message_id ?? null,
    created_at: now,
    updated_at: now,
  };
  await db.execute(
    `INSERT INTO sessions
     (id, title, model_ref, system_prompt, compact_strategy, pinned, context_tokens, compacting, parent_session_id, parent_message_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, $7, $8, $9)`,
    [
      session.id,
      session.title,
      session.model_ref,
      session.system_prompt,
      session.compact_strategy,
      session.parent_session_id,
      session.parent_message_id,
      session.created_at,
      session.updated_at,
    ],
  );
  return session;
}

// [START] Phase 8 — forkSession: clone a session up to (and including) the
// chosen message into a fresh session. The new session inherits the source's
// model/system_prompt/compact_strategy and records `parent_session_id` +
// `parent_message_id` so the sidebar can show a `↳ branched from` indicator.
// Live messages only — compacted summaries are intentionally skipped so the
// fork starts with a clean visible history.
export interface ForkSessionInput {
  src_session_id: string;
  fork_message_id: string;
  /** Optional title for the new session — defaults to "[branch] {src.title}". */
  title?: string;
}

export async function forkSession(input: ForkSessionInput): Promise<Session> {
  const src = await getSession(input.src_session_id);
  if (!src) throw new Error(`source session not found: ${input.src_session_id}`);

  // Pull the fork-point message to get its created_at — anything ≤ that time
  // is included in the new session. Using created_at (not row order) lets the
  // copy match listLiveMessages' ordering exactly.
  const db = await getDb();
  const pivot = await db.select<MessageRow[]>(
    `SELECT * FROM messages WHERE id = $1 AND session_id = $2 LIMIT 1`,
    [input.fork_message_id, input.src_session_id],
  );
  if (pivot.length === 0) {
    throw new Error(`fork message not found: ${input.fork_message_id}`);
  }
  const pivotTs = pivot[0].created_at;

  const branch = await createSession({
    title: input.title ?? (src.title ? `↳ ${src.title}` : "↳ branch"),
    model_ref: src.model_ref,
    system_prompt: src.system_prompt,
    compact_strategy: src.compact_strategy,
    parent_session_id: src.id,
    parent_message_id: input.fork_message_id,
  });

  // Copy live messages with created_at ≤ pivot — preserve order by reusing the
  // original timestamps (small + offset to keep them strictly past `branch.created_at`
  // would risk collisions; SQLite ORDER BY ASC remains stable).
  const rows = await db.select<MessageRow[]>(
    `SELECT * FROM messages
       WHERE session_id = $1 AND compacted = 0 AND created_at <= $2
       ORDER BY created_at ASC`,
    [input.src_session_id, pivotTs],
  );
  for (const r of rows) {
    await db.execute(
      `INSERT INTO messages
        (id, session_id, role, content, attachments_json, prompt_tokens, generation_tokens, compacted, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
      [
        newId(),
        branch.id,
        r.role,
        r.content,
        r.attachments_json,
        r.prompt_tokens,
        r.generation_tokens,
        r.created_at,
      ],
    );
  }

  return branch;
}
// [END]

export async function listSessions(): Promise<Session[]> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    `SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC`,
  );
  return rows.map(rowToSession);
}

export async function getSession(id: string): Promise<Session | null> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    `SELECT * FROM sessions WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToSession(rows[0]) : null;
}

export async function renameSession(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET title = $1, updated_at = $2 WHERE id = $3`,
    [title, nowMs(), id],
  );
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET pinned = $1, updated_at = $2 WHERE id = $3`,
    [pinned ? 1 : 0, nowMs(), id],
  );
}

export async function setCompactStrategy(
  id: string,
  strategy: CompactStrategy,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET compact_strategy = $1, updated_at = $2 WHERE id = $3`,
    [strategy, nowMs(), id],
  );
}

export async function setModelRef(id: string, modelRef: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET model_ref = $1, updated_at = $2 WHERE id = $3`,
    [modelRef, nowMs(), id],
  );
}

export async function setContextTokens(id: string, tokens: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET context_tokens = $1, updated_at = $2 WHERE id = $3`,
    [tokens, nowMs(), id],
  );
}

export async function setCompacting(id: string, compacting: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET compacting = $1, updated_at = $2 WHERE id = $3`,
    [compacting ? 1 : 0, nowMs(), id],
  );
}

// [START] Phase A — helpers to extract stored attachment paths before row deletion
function extractStoredPaths(atts: ChatAttachment[] | null): string[] {
  if (!atts) return [];
  return atts
    .filter((a): a is Extract<ChatAttachment, { kind: "stored" }> => a.kind === "stored")
    .map((a) => a.meta.relativePath);
}

async function deleteAttachmentsForMessages(messages: { attachments_json: string | null }[]): Promise<void> {
  for (const row of messages) {
    if (!row.attachments_json) continue;
    try {
      const parsed: unknown = JSON.parse(row.attachments_json);
      if (!Array.isArray(parsed)) continue;
      const paths = extractStoredPaths(parsed as ChatAttachment[]);
      for (const p of paths) await deleteAttachment(p);
    } catch {
      // malformed json — ignore
    }
  }
}
// [END]

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  // [START] Phase A — delete stored attachment files before cascade delete
  const rows = await db.select<{ attachments_json: string | null }[]>(
    `SELECT attachments_json FROM messages WHERE session_id = $1 AND attachments_json IS NOT NULL`,
    [id],
  );
  await deleteAttachmentsForMessages(rows);
  // [END]
  // ON DELETE CASCADE clears messages automatically.
  await db.execute(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export async function searchSessions(query: string): Promise<Session[]> {
  const q = query.trim();
  if (!q) return listSessions();
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    `SELECT * FROM sessions WHERE title LIKE $1 ORDER BY pinned DESC, updated_at DESC`,
    [`%${q}%`],
  );
  return rows.map(rowToSession);
}

// --- Messages CRUD -----------------------------------------------------------

export interface AppendMessageInput {
  session_id: string;
  role: MessageRole;
  content: string;
  attachments?: ChatAttachment[] | null;
  prompt_tokens?: number | null;
  generation_tokens?: number | null;
}

function serializeAttachments(atts: ChatAttachment[] | null | undefined): string | null {
  if (!atts || atts.length === 0) return null;
  // [START] Phase A — Serialize only DB-safe attachment kinds.
  // stored: persists meta object (id, filename, mime, size, relativePath).
  // url: persists as-is.
  // file (in-flight): should have been converted to stored before reaching here;
  //   if it slipped through, fall back to previewDataUrl as url kind.
  const persistable = atts
    .map((a): ChatAttachment | null => {
      if (a.kind === "url") return a;
      if (a.kind === "stored") return a;
      // file kind fallback — save the preview data-url if present.
      if (a.previewDataUrl) {
        return { kind: "url", id: a.id, url: a.previewDataUrl };
      }
      return null;
    })
    .filter((a): a is ChatAttachment => a !== null);
  return persistable.length > 0 ? JSON.stringify(persistable) : null;
  // [END]
}

export async function appendMessage(input: AppendMessageInput): Promise<Message> {
  const db = await getDb();
  const now = nowMs();
  const id = newId();
  const attJson = serializeAttachments(input.attachments);
  await db.execute(
    `INSERT INTO messages
     (id, session_id, role, content, attachments_json, prompt_tokens, generation_tokens, compacted, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
    [
      id,
      input.session_id,
      input.role,
      input.content,
      attJson,
      input.prompt_tokens ?? null,
      input.generation_tokens ?? null,
      now,
    ],
  );
  await db.execute(
    `UPDATE sessions SET updated_at = $1 WHERE id = $2`,
    [now, input.session_id],
  );
  return {
    id,
    session_id: input.session_id,
    role: input.role,
    content: input.content,
    attachments: input.attachments ?? null,
    prompt_tokens: input.prompt_tokens ?? null,
    generation_tokens: input.generation_tokens ?? null,
    compacted: false,
    created_at: now,
  };
}

export async function updateMessageContent(
  id: string,
  content: string,
  opts?: { prompt_tokens?: number | null; generation_tokens?: number | null },
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE messages
     SET content = $1,
         prompt_tokens = COALESCE($2, prompt_tokens),
         generation_tokens = COALESCE($3, generation_tokens)
     WHERE id = $4`,
    [content, opts?.prompt_tokens ?? null, opts?.generation_tokens ?? null, id],
  );
}

export async function listMessages(sessionId: string): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.select<MessageRow[]>(
    `SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(rowToMessage);
}

export async function listLiveMessages(sessionId: string): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.select<MessageRow[]>(
    `SELECT * FROM messages WHERE session_id = $1 AND compacted = 0 ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(rowToMessage);
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDb();
  // [START] Phase A — delete stored attachment files before row delete
  const rows = await db.select<{ attachments_json: string | null }[]>(
    `SELECT attachments_json FROM messages WHERE id = $1`,
    [id],
  );
  await deleteAttachmentsForMessages(rows);
  // [END]
  await db.execute(`DELETE FROM messages WHERE id = $1`, [id]);
}

export async function clearMessages(sessionId: string): Promise<void> {
  const db = await getDb();
  // [START] Phase A — delete stored attachment files before bulk delete
  const rows = await db.select<{ attachments_json: string | null }[]>(
    `SELECT attachments_json FROM messages WHERE session_id = $1 AND attachments_json IS NOT NULL`,
    [sessionId],
  );
  await deleteAttachmentsForMessages(rows);
  // [END]
  await db.execute(`DELETE FROM messages WHERE session_id = $1`, [sessionId]);
  await db.execute(
    `UPDATE sessions SET context_tokens = 0, updated_at = $1 WHERE id = $2`,
    [nowMs(), sessionId],
  );
}

export async function markMessagesCompacted(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const db = await getDb();
  const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(
    `UPDATE messages SET compacted = 1 WHERE id IN (${placeholders})`,
    messageIds,
  );
}
