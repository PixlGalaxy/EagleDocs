-- Phase 2: models, connections, chats, the job queue and the agent's own data
-- (steers, approvals, memory, skills, schedules), plus daily usage.

-- Models offered by the admin (the "EagleDocs model"): Ollama or OpenAI-compatible servers.
CREATE TABLE model_endpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('ollama', 'openai_compat')),
  name        text NOT NULL,
  base_url    text NOT NULL,
  api_key_enc bytea,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE models (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     uuid NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE,
  model_name      text NOT NULL,
  display_name    text NOT NULL,
  tags            jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_window  integer NOT NULL DEFAULT 32768,
  supports_tools  boolean NOT NULL DEFAULT true,
  supports_vision boolean NOT NULL DEFAULT false,
  enabled         boolean NOT NULL DEFAULT false,
  UNIQUE (endpoint_id, model_name)
);

-- A user's external accounts and keys. Secrets only in secret_enc.
CREATE TABLE connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('canvas', 'sso', 'degreeworks', 'codex', 'api_key')),
  provider    text,
  label       text NOT NULL,
  secret_enc  bytea,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'untested' CHECK (status IN ('ok', 'error', 'untested', 'waiting_mfa')),
  last_ok_at  timestamptz,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connections_user_idx ON connections (user_id, kind);

-- Codex device logins in progress (any replica may receive the poll).
CREATE TABLE codex_device_logins (
  id             text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_enc      bytea NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_model_prefs (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode              text NOT NULL DEFAULT 'auto' CHECK (mode IN ('manual', 'auto')),
  default_model_ref text,
  auto_map          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE chats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '',
  model_ref  text,
  kind       text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'scheduled')),
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chats_user_idx ON chats (user_id, updated_at DESC);

CREATE TABLE messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id      uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  -- Ordering inside a chat; created_at can tie within one transaction.
  seq          bigserial,
  role         text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content      text NOT NULL DEFAULT '',
  tool_calls   jsonb,
  tool_call_id text,
  tool_name    text,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_ref    text,
  model_label  text,
  tokens_in    integer,
  tokens_out   integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_chat_idx ON messages (chat_id, seq);

-- The queue. Any replica claims queued jobs with FOR UPDATE SKIP LOCKED.
CREATE TABLE jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id        uuid REFERENCES chats(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('chat', 'scheduled', 'sync')),
  status         text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'waiting_approval', 'waiting_mfa', 'done', 'failed', 'cancelled', 'interrupted')),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  node_id        text,
  preferred_node text,
  heartbeat_at   timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  queued_at      timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  error          text
);
CREATE INDEX jobs_queue_idx ON jobs (queued_at) WHERE status = 'queued';
CREATE INDEX jobs_user_idx ON jobs (user_id, queued_at DESC);
CREATE INDEX jobs_running_idx ON jobs (node_id) WHERE status IN ('running', 'waiting_approval', 'waiting_mfa');

-- Everything a job reported, replayable by any replica (SSE with Last-Event-ID).
CREATE TABLE job_events (
  job_id     uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  type       text NOT NULL,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, seq)
);

CREATE TABLE job_steers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX job_steers_pending_idx ON job_steers (job_id) WHERE applied_at IS NULL;

CREATE TABLE approvals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id    uuid REFERENCES chats(id) ON DELETE CASCADE,
  tool_name  text NOT NULL,
  args       jsonb NOT NULL,
  summary    text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX approvals_job_idx ON approvals (job_id);

CREATE TABLE memories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    text NOT NULL,
  tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  source     text NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memories_user_idx ON memories (user_id, created_at DESC);
CREATE INDEX memories_tsv_idx ON memories USING gin (tsv);

-- Personal skills (built-in and institution skills come from files, phase 5).
CREATE TABLE user_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  body_md     text NOT NULL DEFAULT '',
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

-- Built-in skills a user turned off.
CREATE TABLE user_skill_settings (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_slug text NOT NULL,
  enabled    boolean NOT NULL,
  PRIMARY KEY (user_id, skill_slug)
);

CREATE TABLE skill_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_slug text NOT NULL,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skill_notes_idx ON skill_notes (user_id, skill_slug);

CREATE TABLE schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  schedule    text NOT NULL,
  timezone    text NOT NULL,
  prompt      text NOT NULL,
  model_ref   text,
  enabled     boolean NOT NULL DEFAULT true,
  chat_id     uuid REFERENCES chats(id) ON DELETE SET NULL,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedules_due_idx ON schedules (next_run_at) WHERE enabled;

CREATE TABLE usage_daily (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             date NOT NULL,
  messages        integer NOT NULL DEFAULT 0,
  eagledocs_messages integer NOT NULL DEFAULT 0,
  tokens_in       bigint NOT NULL DEFAULT 0,
  tokens_out      bigint NOT NULL DEFAULT 0,
  sandbox_seconds integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Per-user switch: stop saving new memories.
ALTER TABLE users ADD COLUMN memory_paused boolean NOT NULL DEFAULT false;

-- Codex calls that OpenAI refused (403, Cloudflare challenge, authorization).
-- Several distinct accounts failing in a short window trips the global breaker.
CREATE TABLE codex_failures (
  id            bigserial PRIMARY KEY,
  connection_id uuid NOT NULL,
  status        integer NOT NULL,
  message       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codex_failures_time_idx ON codex_failures (created_at);
