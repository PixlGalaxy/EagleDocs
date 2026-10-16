-- Account deletion with 30 days to change one's mind: the account is switched
-- off at once (status 'deleting') and everything is erased after delete_after.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('pending', 'active', 'disabled', 'deleting'));
ALTER TABLE users ADD COLUMN delete_after timestamptz;
CREATE INDEX users_delete_after_idx ON users (delete_after) WHERE delete_after IS NOT NULL;
