-- Accelerator Lab, phase 4: embeddings go through the queue too, and work already done is not done again.

ALTER TABLE lab_tasks DROP CONSTRAINT lab_tasks_kind_check;
ALTER TABLE lab_tasks ADD CONSTRAINT lab_tasks_kind_check CHECK (kind IN ('vision', 'text', 'transcribe', 'embed'));

-- What a task's result depends on (kind, model, prompt and the file's bytes), hashed: the same lecture piece or
-- slide sent again, by anyone, is answered from lab_cache without the GPU. Only someone who has the same bytes
-- can produce the same key, so a cached answer never tells a student about a file they do not have.
ALTER TABLE lab_tasks ADD COLUMN cache_key text;

CREATE TABLE lab_cache (
  key        text PRIMARY KEY,
  kind       text NOT NULL,
  output     jsonb NOT NULL,
  hits       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_cache_used_idx ON lab_cache (used_at);
