-- Prototype D1 schema, adapted from SignuDoc PostgreSQL migrations.
-- This does not yet cover the entire application and is not deployment-ready.
create table if not exists envelopes (
  id text primary key,
  user_id text not null references "user"(id) on delete cascade,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'completed', 'declined', 'voided')),
  source_pdf_key text not null,
  source_pdf_filename text not null,
  source_pdf_size_bytes bigint not null check (source_pdf_size_bytes > 0),
  page_count integer not null check (page_count > 0),
  signed_pdf_key text,
  evidence_key text,
  source_pdf_hash text not null check (length(source_pdf_hash) = 64),
  sent_at bigint,
  completed_at bigint,
  declined_at bigint,
  voided_at bigint,
  created_at bigint not null default (unixepoch()),
  updated_at bigint not null default (unixepoch())
);

create table if not exists envelope_pages (
  id text primary key,
  envelope_id text not null references envelopes(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  width_pt real not null check (width_pt > 0),
  height_pt real not null check (height_pt > 0),
  unique (envelope_id, page_number)
);

create table if not exists signers (
  id text primary key,
  envelope_id text not null references envelopes(id) on delete cascade,
  name text not null,
  email text not null,
  sign_order integer not null check (sign_order > 0),
  status text not null default 'pending'
    check (status in ('pending', 'notified', 'signed', 'declined')),
  signing_token_hash text,
  signing_token_expires_at bigint,
  turn_started_at bigint,
  last_notified_at bigint,
  last_nudged_at bigint,
  signed_at bigint,
  declined_at bigint,
  decline_reason text,
  created_at bigint not null default (unixepoch()),
  updated_at bigint not null default (unixepoch()),
  constraint signers_id_envelope_unique unique (id, envelope_id),
  constraint signers_envelope_order_unique unique (envelope_id, sign_order)
);

create table if not exists recipient_download_tokens (
  token_hash text primary key check (length(token_hash) = 64),
  envelope_id text not null,
  signer_id text not null,
  file_type text not null check (file_type in ('signed', 'evidence')),
  expires_at bigint not null,
  created_at bigint not null default (unixepoch()),
  constraint recipient_download_tokens_signer_envelope_fk
    foreign key (signer_id, envelope_id)
    references signers(id, envelope_id)
    on delete cascade,
  constraint recipient_download_tokens_signer_file_unique
    unique (envelope_id, signer_id, file_type),
  check (expires_at >= created_at)
);

create table if not exists fields (
  id text primary key,
  envelope_id text not null references envelopes(id) on delete cascade,
  signer_id text not null,
  type text not null
    check (type in ('signature', 'initials', 'date', 'text', 'checkbox', 'number', 'dropdown', 'radio')),
  page integer not null check (page > 0),
  x real not null check (x >= 0 and x <= 1),
  y real not null check (y >= 0 and y <= 1),
  width real not null check (width > 0 and width <= 1),
  height real not null check (height > 0 and height <= 1),
  required boolean not null default true,
  label text,
  input_method text
    check (input_method is null or input_method in ('typed', 'drawn', 'auto')),
  value text,
  image_key text,
  checked boolean,
  submitted_at bigint,
  created_at bigint not null default (unixepoch()),
  updated_at bigint not null default (unixepoch()),
  check (x + width <= 1.000001),
  check (y + height <= 1.000001),
  constraint fields_signer_envelope_fk
    foreign key (signer_id, envelope_id)
    references signers(id, envelope_id)
    on delete cascade
);

create table if not exists audit_events (
  id text primary key,
  envelope_id text not null references envelopes(id) on delete cascade,
  event text not null
    check (event in (
      'created',
      'sent',
      'viewed',
      'signed',
      'declined',
      'reminded_manual',
      'completed',
      'voided', 'consented', 'verified', 'verification_failed', 'email_sent',
      'deadline_changed', 'expired', 'reminded_auto', 'reauthentication_failed',
      'copied', 'signer_corrected'
    )),
  actor_type text not null
    check (actor_type in ('sender', 'signer', 'system')),
  actor_email text,
  ip_address text,
  user_agent text,
  metadata text check (metadata is null or json_valid(metadata)),
  created_at bigint not null default (unixepoch())
);

create table if not exists account_closure_requests (
  user_id text primary key references "user"(id) on delete cascade,
  requested_at bigint not null,
  export_expires_at bigint not null,
  purge_after_at bigint not null,
  updated_at bigint not null,
  check (export_expires_at >= requested_at),
  check (purge_after_at >= export_expires_at)
);

create index if not exists account_userid_idx
  on account ("userId");

create index if not exists session_userid_idx
  on session ("userId");

create index if not exists verification_identifier_idx
  on verification (identifier);

create index if not exists idx_envelopes_user_created_at
  on envelopes(user_id, created_at desc);

create index if not exists idx_envelopes_user_status
  on envelopes(user_id, status, created_at desc);

create unique index if not exists idx_signers_envelope_email
  on signers(envelope_id, lower(email));

create index if not exists idx_signers_envelope_status
  on signers(envelope_id, status);

create unique index if not exists idx_signers_signing_token_hash
  on signers(signing_token_hash)
  where signing_token_hash is not null;

create unique index if not exists idx_signers_single_notified
  on signers(envelope_id)
  where status = 'notified';

create index if not exists idx_recipient_download_tokens_expires_at
  on recipient_download_tokens(expires_at);

create index if not exists idx_fields_signer_envelope
  on fields(signer_id, envelope_id);

create index if not exists idx_fields_envelope_page
  on fields(envelope_id, page, created_at, id);

create index if not exists idx_audit_events_envelope_event
  on audit_events(envelope_id, event);

create index if not exists idx_audit_events_envelope_created_at
  on audit_events(envelope_id, created_at, id);

create index if not exists idx_audit_events_envelope_event_signer_id
  on audit_events(envelope_id, event, ((metadata->>'signerId')));

create index if not exists idx_account_closure_requests_purge_after
  on account_closure_requests(purge_after_at, requested_at);

ALTER TABLE envelopes ADD COLUMN signed_pdf_sha256 TEXT CHECK (signed_pdf_sha256 IS NULL OR length(signed_pdf_sha256) = 64);
ALTER TABLE envelopes ADD COLUMN evidence_sha256 TEXT CHECK (evidence_sha256 IS NULL OR length(evidence_sha256) = 64);
ALTER TABLE envelopes ADD COLUMN recipient_evidence_sha256 TEXT CHECK (recipient_evidence_sha256 IS NULL OR length(recipient_evidence_sha256) = 64);
ALTER TABLE envelopes ADD COLUMN retention_warned_at INTEGER;
ALTER TABLE envelopes ADD COLUMN expires_at INTEGER;
ALTER TABLE envelopes ADD COLUMN expiry_notified_at INTEGER;
ALTER TABLE envelopes ADD COLUMN reminder_interval_days INTEGER CHECK (reminder_interval_days IS NULL OR reminder_interval_days BETWEEN 1 AND 30);
ALTER TABLE envelopes ADD COLUMN handed_over_at INTEGER;
ALTER TABLE envelopes ADD COLUMN part11 INTEGER NOT NULL DEFAULT 0 CHECK (part11 IN (0, 1));
ALTER TABLE envelopes ADD COLUMN signature_level TEXT NOT NULL DEFAULT 'simple' CHECK (signature_level IN ('simple', 'advanced', 'qualified'));
ALTER TABLE envelopes ADD COLUMN signature_provider TEXT CHECK ((signature_level = 'simple') = (signature_provider IS NULL));
ALTER TABLE envelopes ADD COLUMN revision_key TEXT;
ALTER TABLE envelopes ADD COLUMN revision_sha256 TEXT;
ALTER TABLE signers ADD COLUMN access_code_hash TEXT;
ALTER TABLE signers ADD COLUMN require_email_code INTEGER NOT NULL DEFAULT 0 CHECK (require_email_code IN (0, 1));
ALTER TABLE signers ADD COLUMN email_code_hash TEXT;
ALTER TABLE signers ADD COLUMN email_code_expires_at INTEGER;
ALTER TABLE signers ADD COLUMN email_code_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signers ADD COLUMN email_code_sent_at INTEGER;
ALTER TABLE signers ADD COLUMN consented_at INTEGER;
ALTER TABLE signers ADD COLUMN role TEXT NOT NULL DEFAULT 'signer' CHECK (role IN ('signer', 'cc') AND (role = 'signer' OR (status = 'pending' AND signing_token_hash IS NULL)));
ALTER TABLE signers ADD COLUMN user_id TEXT;
ALTER TABLE signers ADD COLUMN signature_meaning TEXT CHECK (signature_meaning IS NULL OR signature_meaning IN ('approval', 'review', 'responsibility', 'authorship'));
ALTER TABLE fields ADD COLUMN options TEXT CHECK (options IS NULL OR (type = 'dropdown' AND json_valid(options) AND json_type(options) = 'array'));
ALTER TABLE fields ADD COLUMN group_id TEXT CHECK ((type = 'radio') = (group_id IS NOT NULL));
ALTER TABLE audit_events ADD COLUMN sequence INTEGER;
ALTER TABLE audit_events ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_events ADD COLUMN row_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_envelope_sequence ON audit_events(envelope_id, sequence) WHERE sequence IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fields_envelope_group ON fields(envelope_id, group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_envelopes_expiry_due ON envelopes(expires_at) WHERE status = 'sent' AND expires_at IS NOT NULL AND expiry_notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_envelopes_reminders_on ON envelopes(id) WHERE status = 'sent' AND reminder_interval_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_envelopes_signed_pdf_sha256 ON envelopes(signed_pdf_sha256) WHERE signed_pdf_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_envelopes_evidence_sha256 ON envelopes(evidence_sha256) WHERE evidence_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_envelopes_recipient_evidence_sha256 ON envelopes(recipient_evidence_sha256) WHERE recipient_evidence_sha256 IS NOT NULL;
