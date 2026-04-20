-- Phase 8 · Message branching / session forks.
-- A "fork" copies a session's history up to (and including) a chosen message
-- into a fresh session, then keeps editing diverges from there. We record
-- the lineage on the new session so the UI can render a `↳ branched from X`
-- indicator and the user can navigate back to the parent.
--
--   parent_session_id : the session we forked off of (NULL for roots)
--   parent_message_id : the exact message inside that parent we forked at
--
-- Both are TEXT (matching the id columns) and nullable so existing sessions
-- stay unaffected. SQLite ADD COLUMN can't carry a foreign-key constraint
-- to an existing table, so we enforce referential integrity in app code
-- (db/sessions.ts forkSession). The parent index keeps the "list children
-- of session X" query cheap.

ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN parent_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
