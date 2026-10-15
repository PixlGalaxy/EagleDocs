-- Forks: a chat copied from another one (up to an answer) that goes its own way. Deleting a chat deletes
-- its forks too, at every level. fork_label numbers them under their parent: "1", "2", "2.1"...
ALTER TABLE chats ADD COLUMN parent_id uuid REFERENCES chats(id) ON DELETE CASCADE;
ALTER TABLE chats ADD COLUMN fork_label text;
CREATE INDEX chats_parent_idx ON chats (parent_id);
