-- What a student may do each day from ChatGPT, Claude and other MCP apps (0 = unlimited). Code runs use their sandbox.
ALTER TABLE tiers ADD COLUMN mcp_daily_calls integer NOT NULL DEFAULT 300 CHECK (mcp_daily_calls >= 0);
ALTER TABLE tiers ADD COLUMN mcp_daily_code_runs integer NOT NULL DEFAULT 40 CHECK (mcp_daily_code_runs >= 0);
UPDATE tiers SET mcp_daily_calls = 1500, mcp_daily_code_runs = 200 WHERE name = 'Plus';
UPDATE tiers SET mcp_daily_calls = 0, mcp_daily_code_runs = 1000 WHERE name = 'Pro';

ALTER TABLE usage_daily ADD COLUMN mcp_calls integer NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN mcp_code_runs integer NOT NULL DEFAULT 0;
