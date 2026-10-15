-- Plans (tiers): what each student gets. Assigned by the admin (optionally until a date) or by a Stripe subscription.
CREATE TABLE tiers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  sort                   integer NOT NULL DEFAULT 0,
  price_cents            integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency               text NOT NULL DEFAULT 'usd',
  stripe_price_id        text,
  -- Sandbox
  cpu                    numeric(4, 2) NOT NULL DEFAULT 1 CHECK (cpu > 0),
  mem_mb                 integer NOT NULL DEFAULT 2048 CHECK (mem_mb >= 256),
  disk_mb                integer NOT NULL DEFAULT 5120 CHECK (disk_mb >= 100),
  -- Agent
  daily_messages         integer NOT NULL DEFAULT 100 CHECK (daily_messages >= 0), -- EagleDocs-model turns per day; 0 = unlimited
  max_background_jobs    integer NOT NULL DEFAULT 2 CHECK (max_background_jobs >= 1), -- jobs running at once
  max_schedules          integer NOT NULL DEFAULT 3 CHECK (max_schedules >= 0),
  max_parallel_subagents integer NOT NULL DEFAULT 3 CHECK (max_parallel_subagents BETWEEN 1 AND 10),
  max_subagent_depth     integer NOT NULL DEFAULT 2 CHECK (max_subagent_depth BETWEEN 0 AND 3),
  is_default             boolean NOT NULL DEFAULT false,
  enabled                boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tiers_single_default ON tiers (is_default) WHERE is_default;
CREATE UNIQUE INDEX tiers_stripe_price ON tiers (stripe_price_id) WHERE stripe_price_id IS NOT NULL;

INSERT INTO tiers (name, sort, price_cents, cpu, mem_mb, disk_mb, daily_messages, max_background_jobs, max_schedules, max_parallel_subagents, max_subagent_depth, is_default, enabled)
VALUES
  ('Free', 0, 0,    1, 2048,  5120, 100, 2, 3,  3, 2, true,  true),
  ('Plus', 1, 800,  2, 3072, 15360, 500, 3, 10, 5, 2, false, false),
  ('Pro',  2, 2000, 4, 4096, 51200, 0,   5, 25, 8, 3, false, false);

-- An assigned plan can expire (scholarships, trials); then the default applies again.
UPDATE users SET tier_id = NULL WHERE tier_id IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_tier_fk FOREIGN KEY (tier_id) REFERENCES tiers(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN tier_expires_at timestamptz;

-- The plan that applies to a student now: their own (if not expired) or the default. Used by the job queue too.
CREATE FUNCTION effective_tier(p_user uuid) RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT u.tier_id FROM users u JOIN tiers t ON t.id = u.tier_id
      WHERE u.id = p_user AND (u.tier_expires_at IS NULL OR u.tier_expires_at > now())),
    (SELECT id FROM tiers WHERE is_default LIMIT 1)
  );
$$ LANGUAGE sql STABLE;

-- One Stripe subscription per student (Checkout creates it, webhooks keep it current).
CREATE TABLE subscriptions (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id     text NOT NULL,
  stripe_subscription_id text UNIQUE,
  tier_id                uuid REFERENCES tiers(id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'incomplete',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  -- After a failed payment the plan stays until then; afterwards the student goes back to the default plan.
  grace_until            timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_customer_idx ON subscriptions (stripe_customer_id);

-- Webhooks may arrive twice, at any replica, in parallel: each event is processed once.
CREATE TABLE stripe_events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
