-- A student switching a built-in skill off (personal skills keep their own enabled flag in user_skills).
CREATE TABLE user_skill_prefs (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_slug text NOT NULL,
  enabled    boolean NOT NULL,
  PRIMARY KEY (user_id, skill_slug)
);
