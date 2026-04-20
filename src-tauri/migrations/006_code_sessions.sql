-- Phase 8: Code IDE sessions + agent messages
CREATE TABLE IF NOT EXISTS code_sessions (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',
  project_path   TEXT NOT NULL,
  open_files     TEXT,           -- JSON array of open file paths
  active_file    TEXT,           -- currently focused file path
  model_ref      TEXT,           -- code completion / agent model
  pinned         INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_sessions_updated ON code_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS code_session_messages (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES code_sessions(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool_result')),
  content        TEXT NOT NULL,
  attachments_json TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_messages_session ON code_session_messages(session_id, created_at ASC);
