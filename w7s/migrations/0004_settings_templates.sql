-- Prototype settings and supporting tables. Queries and transaction behavior
-- are still being ported and this schema must not be deployed yet.
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  organization_name TEXT,
  sender_address TEXT,
  support_address TEXT,
  signup_mode TEXT NOT NULL DEFAULT 'closed' CHECK (signup_mode IN ('closed', 'domains', 'open')),
  allowed_email_domains TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_email_domains) AND json_type(allowed_email_domains) = 'array'),
  terms_url TEXT,
  privacy_url TEXT,
  email_ready_at INTEGER,
  setup_completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  retention_days INTEGER CHECK (retention_days IS NULL OR retention_days >= 30),
  part11_mode INTEGER NOT NULL DEFAULT 0 CHECK (part11_mode IN (0, 1)),
  brand_color TEXT CHECK (brand_color IS NULL OR (length(brand_color) = 7 AND substr(brand_color, 1, 1) = '#' AND substr(brand_color, 2) NOT GLOB '*[^0-9a-f]*')),
  logo_content_type TEXT,
  logo_data BLOB,
  logo_hash TEXT,
  CHECK ((logo_data IS NULL AND logo_content_type IS NULL AND logo_hash IS NULL)
    OR (logo_data IS NOT NULL AND logo_content_type IS NOT NULL AND logo_hash IS NOT NULL
      AND logo_content_type IN ('image/png', 'image/jpeg', 'image/webp')
      AND length(logo_data) BETWEEN 1 AND 524288 AND length(logo_hash) = 16
      AND logo_hash NOT GLOB '*[^0-9a-f]*'))
);

CREATE TABLE seal_keys (
  id TEXT PRIMARY KEY,
  certificate_pem TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retired_at INTEGER
);
CREATE UNIQUE INDEX idx_seal_keys_single_active ON seal_keys ((1)) WHERE retired_at IS NULL;

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  source_pdf_key TEXT NOT NULL,
  source_pdf_filename TEXT NOT NULL,
  source_pdf_size_bytes INTEGER NOT NULL CHECK (source_pdf_size_bytes > 0),
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  roles TEXT NOT NULL CHECK (json_valid(roles) AND json_type(roles) = 'array' AND json_array_length(roles) BETWEEN 1 AND 10),
  fields TEXT NOT NULL CHECK (json_valid(fields) AND json_type(fields) = 'array'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_templates_user_created_at ON templates(user_id, created_at DESC, id);

CREATE TABLE system_audit_events (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE,
  event TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email TEXT,
  target_user_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  created_at INTEGER NOT NULL,
  prev_hash TEXT,
  row_hash TEXT NOT NULL
);
CREATE INDEX idx_system_audit_events_created_at ON system_audit_events(created_at DESC);

CREATE TABLE provider_signing_sessions (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  signer_id TEXT NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('advanced', 'qualified')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'signing', 'completed', 'failed')),
  base_sha256 TEXT,
  revision_key TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  secret_data TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_provider_signing_sessions_signer ON provider_signing_sessions(signer_id, state);
CREATE INDEX idx_provider_signing_sessions_envelope ON provider_signing_sessions(envelope_id);
