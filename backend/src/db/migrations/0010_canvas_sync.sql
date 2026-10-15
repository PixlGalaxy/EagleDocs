-- Last sync of each student's "<Term>/<Course>/" folders from Canvas (every few hours, on connect, or on demand).
CREATE TABLE canvas_sync (
  user_id   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  synced_at timestamptz,
  term      text,
  courses   integer NOT NULL DEFAULT 0,
  error     text
);
