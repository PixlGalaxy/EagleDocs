-- Hermes-style memory: per student, the agent's SOUL.md (personality), USER.md (who the student is) and
-- MEMORY.md (its own notes), all in every conversation. Replaces the loose facts in `memories`, which
-- move into USER.md (that table stays one release for safety, unused).
CREATE TABLE agent_docs (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc        text NOT NULL CHECK (doc IN ('soul', 'user', 'notes')),
  content    text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc)
);

INSERT INTO agent_docs (user_id, doc, content)
SELECT user_id, 'user', string_agg(content, E'\n§\n' ORDER BY created_at)
  FROM memories GROUP BY user_id;
