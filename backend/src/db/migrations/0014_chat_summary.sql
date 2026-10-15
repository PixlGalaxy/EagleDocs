-- "Compact" in the chat: a summary replaces, for the model only, every message up to summary_until_seq.
-- The student still sees the whole conversation.
ALTER TABLE chats ADD COLUMN summary text;
ALTER TABLE chats ADD COLUMN summary_until_seq bigint;
