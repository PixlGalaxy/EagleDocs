-- EagleDocs as an MCP app for ChatGPT, Claude and other MCP clients, with EagleDocs as the OAuth 2.1 server.

-- Clients register themselves (RFC 7591). Public clients use PKCE only; confidential ones also get a secret (hashed).
CREATE TABLE oauth_clients (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  client_uri    text,
  redirect_uris text[] NOT NULL,
  secret_hash   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One /oauth/authorize request, from the redirect to the consent screen to the code exchange.
CREATE TABLE oauth_requests (
  id             text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  scopes         text[] NOT NULL,
  state          text,
  resource       text,
  user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
  -- Set when the student approves; single use.
  code_hash      text UNIQUE,
  granted_scopes text[],
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);

-- A student's authorization of one client: what Settings → Apps lists and revokes.
CREATE TABLE oauth_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scopes       text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX oauth_grants_user_idx ON oauth_grants (user_id) WHERE revoked_at IS NULL;

-- Opaque tokens, stored as SHA-256. Every MCP call reads this table, so revoking works at once on every replica.
CREATE TABLE oauth_tokens (
  token_hash text PRIMARY KEY,
  grant_id   uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_grant_idx ON oauth_tokens (grant_id);
