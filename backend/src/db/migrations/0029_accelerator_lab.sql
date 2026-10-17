-- Accelerator Lab: the server's GPU does batch work (transcription, image descriptions, summaries) through one fair
-- queue, never straight from the sandbox. One worker in the whole cluster runs one task at a time.
-- Accelerator Units: 1 AU = one minute of GPU time. Windows of a day and a week start with the first use, like the
-- Compute Units; past a limit no new task is queued (a GPU cannot be slowed down like a CPU).

CREATE TABLE lab_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('vision', 'text', 'transcribe')),
  -- 0 = interactive (a picture in the chat), 1 = batch (a lecture's chunks).
  priority    smallint NOT NULL DEFAULT 1 CHECK (priority IN (0, 1)),
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  -- The model the task needs: the worker prefers the one it already has loaded.
  model       text NOT NULL,
  input       jsonb NOT NULL,
  output      jsonb,
  error       text,
  gpu_ms      integer NOT NULL DEFAULT 0,
  node_id     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);
CREATE INDEX lab_tasks_queue_idx ON lab_tasks (priority, created_at) WHERE status = 'queued';
-- The fair queue asks when each user was last served.
CREATE INDEX lab_tasks_user_idx ON lab_tasks (user_id, started_at DESC);

CREATE TABLE lab_windows (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('day', 'week')),
  started_at timestamptz NOT NULL,
  used_ms    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind)
);

ALTER TABLE usage_daily ADD COLUMN lab_ms bigint NOT NULL DEFAULT 0;

-- Units each plan includes per window; 0 = unlimited.
ALTER TABLE tiers ADD COLUMN accelerator_units_daily numeric(7, 2) NOT NULL DEFAULT 15 CHECK (accelerator_units_daily >= 0);
ALTER TABLE tiers ADD COLUMN accelerator_units_weekly numeric(7, 2) NOT NULL DEFAULT 60 CHECK (accelerator_units_weekly >= 0);
UPDATE tiers SET accelerator_units_daily = 15, accelerator_units_weekly = 60 WHERE name = 'Free';
UPDATE tiers SET accelerator_units_daily = 60, accelerator_units_weekly = 300 WHERE name = 'Plus';
UPDATE tiers SET accelerator_units_daily = 180, accelerator_units_weekly = 900 WHERE name = 'Pro';
