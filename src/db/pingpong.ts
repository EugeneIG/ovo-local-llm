// [START] Ping Pong session + message persistence.
import { getDb, newId, nowMs } from "./index";

export interface PingpongSession {
  id: string;
  title: string;
  left_model: string;
  left_name: string;
  left_persona: string;
  right_model: string;
  right_name: string;
  right_persona: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface PingpongMessage {
  id: string;
  session_id: string;
  speaker: string;
  side: "left" | "right" | "user";
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

interface SessionRow {
  id: string;
  title: string;
  left_model: string;
  left_name: string;
  left_persona: string;
  right_model: string;
  right_name: string;
  right_persona: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  speaker: string;
  side: string;
  role: string;
  content: string;
  created_at: number;
}

function rowToSession(r: SessionRow): PingpongSession {
  return { ...r, pinned: r.pinned === 1 };
}

function rowToMessage(r: MessageRow): PingpongMessage {
  return r as PingpongMessage;
}

export async function createPingpongSession(params: {
  title?: string;
  left_model: string;
  left_name: string;
  left_persona: string;
  right_model: string;
  right_name: string;
  right_persona: string;
}): Promise<PingpongSession> {
  const db = await getDb();
  const id = newId();
  const now = nowMs();
  const title = params.title || `${params.left_name} vs ${params.right_name}`;
  await db.execute(
    `INSERT INTO pingpong_sessions (id, title, left_model, left_name, left_persona, right_model, right_name, right_persona, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, params.left_model, params.left_name, params.left_persona,
     params.right_model, params.right_name, params.right_persona, now, now],
  );
  return {
    id, title,
    left_model: params.left_model, left_name: params.left_name, left_persona: params.left_persona,
    right_model: params.right_model, right_name: params.right_name, right_persona: params.right_persona,
    pinned: false, created_at: now, updated_at: now,
  };
}

export async function listPingpongSessions(): Promise<PingpongSession[]> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    "SELECT * FROM pingpong_sessions ORDER BY updated_at DESC LIMIT 50",
  );
  return rows.map(rowToSession);
}

export async function deletePingpongSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM pingpong_sessions WHERE id = ?", [id]);
}

export async function addPingpongMessage(params: {
  session_id: string;
  speaker: string;
  side: "left" | "right" | "user";
  role: "user" | "assistant";
  content: string;
}): Promise<PingpongMessage> {
  const db = await getDb();
  const id = newId();
  const now = nowMs();
  await db.execute(
    `INSERT INTO pingpong_messages (id, session_id, speaker, side, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, params.session_id, params.speaker, params.side, params.role, params.content, now],
  );
  await db.execute(
    "UPDATE pingpong_sessions SET updated_at = ? WHERE id = ?",
    [now, params.session_id],
  );
  return { id, ...params, created_at: now };
}

export async function loadPingpongMessages(sessionId: string): Promise<PingpongMessage[]> {
  const db = await getDb();
  const rows = await db.select<MessageRow[]>(
    "SELECT * FROM pingpong_messages WHERE session_id = ? ORDER BY created_at ASC",
    [sessionId],
  );
  return rows.map(rowToMessage);
}
// [END]
