-- The "<Term>/<Course>/" folders copied from Canvas are gone: the agent reads Canvas live, so a copy never goes stale.
DROP TABLE IF EXISTS canvas_sync;
