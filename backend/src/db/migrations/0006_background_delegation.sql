-- Background delegation: helper agents started with agent_delegate(background) run as their own
-- 'delegate' job. It keeps its chat in payload.chat_id, not chat_id, so the chat stays free for
-- new messages while the helpers work; their reports come back as a new turn of the chat.
ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('chat', 'scheduled', 'sync', 'delegate'));

CREATE INDEX jobs_delegate_chat_idx ON jobs ((payload->>'chat_id'))
  WHERE kind = 'delegate' AND status IN ('queued', 'running');
