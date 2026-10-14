-- Log lines from every replica, so the admin panel shows the whole cluster
-- whichever replica answers. Written in batches by logs/log-shipper.ts and
-- trimmed by the housekeeping leader task.
CREATE TABLE app_logs (
  id      bigserial PRIMARY KEY,
  node_id text NOT NULL,
  time    timestamptz NOT NULL,
  channel text NOT NULL,
  level   text NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  message text NOT NULL
);
CREATE INDEX app_logs_time_idx ON app_logs (time);
CREATE INDEX app_logs_node_idx ON app_logs (node_id, id);
