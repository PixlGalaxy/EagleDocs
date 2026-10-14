-- Web push: one row per device the student turned notifications on for.
CREATE TABLE push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  -- What this device wants: mfa_required, job_done, approval_required, broadcast.
  kinds        text[] NOT NULL DEFAULT '{mfa_required,job_done,approval_required,broadcast}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Admin announcements: pushed once, and shown as a banner in the app for a week.
CREATE TABLE broadcasts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  body           text NOT NULL DEFAULT '',
  url            text,
  -- NULL: everyone.
  institution_id uuid REFERENCES institutions(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  sent           integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX broadcasts_recent_idx ON broadcasts (created_at DESC);

-- Set while a browser follows the job's stream (refreshed by its SSE heartbeat): no push needed then.
ALTER TABLE jobs ADD COLUMN watched_at timestamptz;
