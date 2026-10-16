-- What each picture in a student's workspace shows, in words: written when Hawk makes one (its prompt) or looks at one
-- (image_view), so it is not looked at again and images_search can find it by content. Keyed by path; size and
-- modified_at tell when the file changed and the note is stale.
CREATE TABLE image_notes (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path        text NOT NULL,
  size        bigint NOT NULL,
  modified_at timestamptz NOT NULL,
  description text NOT NULL,
  source      text NOT NULL CHECK (source IN ('generated', 'viewed')),
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('simple', left(path || ' ' || description, 100000))) STORED,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path)
);
CREATE INDEX image_notes_tsv_idx ON image_notes USING gin (tsv);
