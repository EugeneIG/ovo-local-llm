-- Ping Pong sessions: two-model conversations
CREATE TABLE IF NOT EXISTS pingpong_sessions (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',
  left_model     TEXT NOT NULL,
  left_name      TEXT NOT NULL DEFAULT '',
  left_persona   TEXT NOT NULL DEFAULT '',
  right_model    TEXT NOT NULL,
  right_name     TEXT NOT NULL DEFAULT '',
  right_persona  TEXT NOT NULL DEFAULT '',
  pinned         INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pingpong_sessions_updated ON pingpong_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS pingpong_messages (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES pingpong_sessions(id) ON DELETE CASCADE,
  speaker        TEXT NOT NULL,
  side           TEXT CHECK (side IN ('left', 'right', 'user')),
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content        TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pingpong_messages_session ON pingpong_messages(session_id, created_at ASC);
