-- Phase 1: accounts, sessions, institutions, settings and the multi-replica plumbing.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE institutions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            citext NOT NULL UNIQUE,
  canvas_base_url text NOT NULL DEFAULT '',
  degreeworks_url text,
  sso_login_url   text,
  outlook_url     text,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE institution_domains (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id     uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  domain             citext NOT NULL UNIQUE,
  include_subdomains boolean NOT NULL DEFAULT false
);
CREATE INDEX institution_domains_institution_idx ON institution_domains (institution_id);

-- Which built-in skills each institution offers (filled in phase 5).
CREATE TABLE institution_skills (
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  skill_slug     text NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (institution_id, skill_slug)
);

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  username          citext NOT NULL UNIQUE,
  password_hash     text NOT NULL,
  display_name      text,
  avatar_path       text,
  role              text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  institution_id    uuid REFERENCES institutions(id) ON DELETE SET NULL,
  -- References tiers once billing lands (phase 6).
  tier_id           uuid,
  language          text NOT NULL DEFAULT 'en',
  timezone          text,
  major             text,
  theme_mode        text NOT NULL DEFAULT 'system',
  theme_skin        text NOT NULL DEFAULT 'eagle',
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_institution_idx ON users (institution_id);

CREATE TABLE sessions (
  id           text PRIMARY KEY, -- sha256 of the cookie token
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent   text,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE email_verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  code_hash  text NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_expires_idx ON email_verifications (expires_at);

CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fixed-window counters shared by every replica.
CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);

-- Admin-editable settings. Secrets go in secret_enc (AES-256-GCM, see crypto/secrets.ts), never in value.
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb,
  secret_enc bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per replica, refreshed by its heartbeat.
CREATE TABLE nodes (
  id           text PRIMARY KEY,
  hostname     text NOT NULL,
  version      text NOT NULL,
  started_at   timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
