-- Daily summary: a morning push with what is due today and tomorrow in Canvas, built without a model. The hour is local
-- to the student's timezone; last_sent_on is the local date of the last send, so each day goes out once whatever the
-- replicas, restarts or DST changes do.
CREATE TABLE daily_summaries (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  hour         smallint NOT NULL DEFAULT 7 CHECK (hour BETWEEN 0 AND 23),
  last_sent_on date,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_summaries_enabled_idx ON daily_summaries (user_id) WHERE enabled;
