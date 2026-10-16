-- Hawk can search the student's past chats (chats_search): what they and Hawk said, not tool output or a run's inner steps.
-- 'simple' keeps words as written, so Spanish and English both match; accents are handled by a fallback in the query.
ALTER TABLE messages ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
  CASE WHEN role IN ('user', 'assistant') AND NOT (meta ? 'internal') THEN to_tsvector('simple', left(content, 100000)) END
) STORED;
CREATE INDEX messages_tsv_idx ON messages USING gin (tsv);
