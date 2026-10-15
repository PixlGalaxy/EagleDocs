-- When the student last looked at each chat: an answer that arrived later shows as unread
-- (a green dot in the chat list). Existing chats count as read now.
ALTER TABLE chats ADD COLUMN last_read_at timestamptz NOT NULL DEFAULT now();
