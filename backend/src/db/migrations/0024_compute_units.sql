-- Compute Units: the sandbox's real CPU time. 1 CU = one core busy for an hour; waiting, reading and idle
-- time barely count, a heavy simulation does. Limits work in windows that start with the first use (like
-- Claude's): a daily window of 24 h and a weekly one of 7 days. Past either limit the sandbox keeps working
-- at a reduced speed until the window ends.

-- Per calendar day, for the usage history.
ALTER TABLE usage_daily ADD COLUMN compute_ms bigint NOT NULL DEFAULT 0;
-- Never written; compute_ms replaces it.
ALTER TABLE usage_daily DROP COLUMN sandbox_seconds;

-- The current windows: when each started (with the first use after the last one ended) and what it used.
CREATE TABLE compute_windows (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('day', 'week')),
  started_at timestamptz NOT NULL,
  used_ms    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind)
);

-- Units each plan includes per window; 0 = unlimited.
ALTER TABLE tiers ADD COLUMN compute_units_daily numeric(7, 2) NOT NULL DEFAULT 2 CHECK (compute_units_daily >= 0);
ALTER TABLE tiers ADD COLUMN compute_units_weekly numeric(7, 2) NOT NULL DEFAULT 10 CHECK (compute_units_weekly >= 0);
UPDATE tiers SET compute_units_daily = 2, compute_units_weekly = 10 WHERE name = 'Free';
UPDATE tiers SET compute_units_daily = 8, compute_units_weekly = 40 WHERE name = 'Plus';
UPDATE tiers SET compute_units_daily = 24, compute_units_weekly = 120 WHERE name = 'Pro';
