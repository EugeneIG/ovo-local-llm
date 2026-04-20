// [START] Phase 8 — Code sessions SQLite CRUD layer
import { getDb, newId, nowMs } from "./index";
import type { CodeSession, CodeAgentMessage } from "../types/code";

// ── Row shapes (DB uses INTEGER for bools, JSON text for arrays) ─────────

interface CodeSessionRow {
  id: string;
  title: string;
  project_path: string;
  open_files: string | null;
  active_file: string | null;
  model_ref: string | null;
  pinned: number;
  created_at: number;
  updated_at: number;
}

interface CodeMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  attachments_json: string | null;
  created_at: number;
}

function rowToSession(r: CodeSessionRow): CodeSession {
  let openFiles: string[] = [];
  if (r.open_files) {
    try {
      openFiles = JSON.parse(r.open_files);
    } catch {
      openFiles = [];
    }
  }
  return {
    id: r.id,
    title: r.title,
    project_path: r.project_path,
    open_files: openFiles,
    active_file: r.active_file,
    model_ref: r.model_ref,
    pinned: r.pinned === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToMessage(r: CodeMessageRow): CodeAgentMessage {
  let attachments = null;
  if (r.attachments_json) {
    try {
      attachments = JSON.parse(r.attachments_json);
    } catch {
      attachments = null;
    }
  }
  return {
    id: r.id,
    session_id: r.session_id,
    role: r.role as CodeAgentMessage["role"],
    content: r.content,
    attachments,
    created_at: r.created_at,
  };
}

// ── Session CRUD ─────────────────────────────────────────────────────────

export async function listCodeSessions(): Promise<CodeSession[]> {
  const db = await getDb();
  const rows = await db.select<CodeSessionRow[]>(
    "SELECT * FROM code_sessions ORDER BY pinned DESC, updated_at DESC",
  );
  return rows.map(rowToSession);
}

export async function getCodeSession(id: string): Promise<CodeSession | null> {
  const db = await getDb();
  const rows = await db.select<CodeSessionRow[]>(
    "SELECT * FROM code_sessions WHERE id = $1",
    [id],
  );
  return rows.length > 0 ? rowToSession(rows[0]) : null;
}

export async function createCodeSession(input: {
  project_path: string;
  title?: string;
  model_ref?: string;
}): Promise<CodeSession> {
  const db = await getDb();
  const id = newId();
  const now = nowMs();
  const title = input.title || input.project_path.split("/").pop() || "Untitled";
  await db.execute(
    `INSERT INTO code_sessions (id, title, project_path, model_ref, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, title, input.project_path, input.model_ref ?? null, now, now],
  );
  return {
    id,
    title,
    project_path: input.project_path,
    open_files: [],
    active_file: null,
    model_ref: input.model_ref ?? null,
    pinned: false,
    created_at: now,
    updated_at: now,
  };
}

export async function renameCodeSession(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE code_sessions SET title = $1, updated_at = $2 WHERE id = $3",
    [title, nowMs(), id],
  );
}

export async function deleteCodeSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM code_sessions WHERE id = $1", [id]);
}

export async function updateCodeSessionFiles(
  id: string,
  openFiles: string[],
  activeFile: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE code_sessions SET open_files = $1, active_file = $2, updated_at = $3 WHERE id = $4",
    [JSON.stringify(openFiles), activeFile, nowMs(), id],
  );
}

export async function updateCodeSessionModel(
  id: string,
  modelRef: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE code_sessions SET model_ref = $1, updated_at = $2 WHERE id = $3",
    [modelRef, nowMs(), id],
  );
}

export async function toggleCodeSessionPinned(id: string, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE code_sessions SET pinned = $1, updated_at = $2 WHERE id = $3",
    [pinned ? 1 : 0, nowMs(), id],
  );
}

// ── Agent Messages ───────────────────────────────────────────────────────

export async function listCodeMessages(sessionId: string): Promise<CodeAgentMessage[]> {
  const db = await getDb();
  const rows = await db.select<CodeMessageRow[]>(
    "SELECT * FROM code_session_messages WHERE session_id = $1 ORDER BY created_at ASC",
    [sessionId],
  );
  return rows.map(rowToMessage);
}

export async function appendCodeMessage(input: {
  session_id: string;
  role: CodeAgentMessage["role"];
  content: string;
  attachments?: CodeAgentMessage["attachments"];
}): Promise<CodeAgentMessage> {
  const db = await getDb();
  const id = newId();
  const now = nowMs();
  const attJson = input.attachments ? JSON.stringify(input.attachments) : null;
  await db.execute(
    `INSERT INTO code_session_messages (id, session_id, role, content, attachments_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.session_id, input.role, input.content, attJson, now],
  );
  // Touch parent session's updated_at
  await db.execute(
    "UPDATE code_sessions SET updated_at = $1 WHERE id = $2",
    [now, input.session_id],
  );
  return {
    id,
    session_id: input.session_id,
    role: input.role,
    content: input.content,
    attachments: input.attachments ?? null,
    created_at: now,
  };
}

// [START] Phase 8 — update an existing message's content.
// Needed so code_agent can persist the final assistant text after the
// stream closes. Without this the DB only ever held the placeholder ""
// we wrote before streaming started, and every app restart wiped the
// assistant half of the transcript.
export async function updateCodeMessageContent(
  id: string,
  content: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE code_session_messages SET content = $1 WHERE id = $2",
    [content, id],
  );
}
// [END]

export async function clearCodeMessages(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM code_session_messages WHERE session_id = $1",
    [sessionId],
  );
}
// [END] Phase 8
