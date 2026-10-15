-- How the chat shows the tools the agent used: 'compact' (one line, expands on click) or 'full' (every tool listed).
ALTER TABLE users ADD COLUMN tool_trace text NOT NULL DEFAULT 'compact' CHECK (tool_trace IN ('compact', 'full'));
