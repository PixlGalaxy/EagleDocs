-- Sandbox affinity: a new job prefers the replica that already runs the user's sandbox, so the
-- container (and its open browser) is reused instead of moved. Workers on other replicas still
-- take the job after a few seconds (AFFINITY_SECONDS in the worker), so a busy or dead node never blocks it.
CREATE FUNCTION jobs_prefer_sandbox_node() RETURNS trigger AS $$
BEGIN
  IF NEW.preferred_node IS NULL THEN
    SELECT node_id INTO NEW.preferred_node FROM sandboxes WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_prefer_sandbox_node
  BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_prefer_sandbox_node();
