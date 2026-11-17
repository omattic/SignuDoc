-- D1 replacement for the PostgreSQL rate limit table.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_at_idx ON rate_limits (expires_at);
