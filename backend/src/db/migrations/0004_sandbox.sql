-- Phase 4: per-user sandboxes (one container per user across the cluster) and browser trust.

-- A row exists while the user's container exists. `node_id` is the replica whose Docker runs it;
-- a job on another replica asks that one to stop it (NOTIFY sandbox_control) and starts its own.
CREATE TABLE sandboxes (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  node_id        text NOT NULL,
  container_id   text NOT NULL,
  status         text NOT NULL CHECK (status IN ('starting', 'running', 'stopping')),
  mem_limit_mb   integer NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sandboxes_node_idx ON sandboxes (node_id);

-- Sites where the agent may click and type in the user's browser without asking each time.
CREATE TABLE browser_trusted_domains (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, domain)
);
