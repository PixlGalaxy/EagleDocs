-- Editing a message (like ChatGPT): what came from that message on is kept in a hidden chat under the
-- original (same folder, never listed), so the student can switch between versions with < 1/2 >.
-- version_group ties the versions of one edited message; version numbers them (1 = the first text).
ALTER TABLE chats ADD COLUMN hidden boolean NOT NULL DEFAULT false;
ALTER TABLE chats ADD COLUMN version_group uuid;
ALTER TABLE chats ADD COLUMN version integer;
CREATE INDEX chats_versions_idx ON chats (parent_id, version_group) WHERE hidden;
