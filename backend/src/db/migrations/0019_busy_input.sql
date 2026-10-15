-- What a message typed while the agent works does: 'steer' corrects the task in progress (the default),
-- 'queue' sends it when the task ends, 'interrupt' stops the task and sends it instead.
ALTER TABLE users ADD COLUMN busy_input text NOT NULL DEFAULT 'steer' CHECK (busy_input IN ('steer', 'queue', 'interrupt'));
