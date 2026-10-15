-- Stripe does not deliver events in order and retries old ones for days: the time of the
-- newest event applied to a subscription, so an older one can never undo it (e.g. a late
-- "updated: active" after "deleted").
ALTER TABLE subscriptions ADD COLUMN last_event_at timestamptz;
