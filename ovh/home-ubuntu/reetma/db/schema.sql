-- Reetma database (Neon Postgres). Applied with `node scripts/db-migrate.mjs`; every statement is idempotent.
-- `mode` separates data created with the Mollie test key (previews) from live data (production).

CREATE TABLE IF NOT EXISTS students (
  id               BIGSERIAL PRIMARY KEY,
  mode             TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  email            TEXT NOT NULL,                 -- always stored lowercase
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  lang             TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'fr')),
  payment_id       TEXT NOT NULL UNIQUE,          -- Mollie payment (tr_…) the account was opened with
  public_ref       TEXT,                          -- ECO-… registration reference
  password_hash    TEXT NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 1,    -- bumped on every change: old sessions and reset links stop working
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ,
  UNIQUE (mode, email)
);
-- nostats: the account was opened with a payment marked metadata.nostats, registered from a country the back-office
-- statistics leave out (api/school/register.js). api/track.js counts neither the account nor its progress.
ALTER TABLE students ADD COLUMN IF NOT EXISTS nostats BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tickets (
  id          BIGSERIAL PRIMARY KEY,
  mode        TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  number      TEXT NOT NULL UNIQUE,               -- T-XXXXXX, shown to the person
  student_id  BIGINT REFERENCES students (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'fr')),
  category    TEXT NOT NULL,
  reference   TEXT,                               -- ECO-… registration reference, if given
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_mode_status_idx ON tickets (mode, status, updated_at DESC);

-- Calls booked on /book-a-call and /prendre-rendez-vous (api/_bookingApi.js): a booking is a ticket of category
-- 'call' with these columns set (NULL on every other ticket). call_at is the start of the call, call_tz the
-- booker's time zone (IANA name), call_cancelled_by 'booker' or 'admin'.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS call_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS call_tz TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS call_cancelled_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS call_cancelled_by TEXT CHECK (call_cancelled_by IN ('booker', 'admin'));
-- One booking per slot and per mode, even when two people book at the same moment (a cancelled call frees its slot).
CREATE UNIQUE INDEX IF NOT EXISTS tickets_call_slot_idx ON tickets (mode, call_at)
  WHERE call_at IS NOT NULL AND call_cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          BIGSERIAL PRIMARY KEY,
  ticket_id   BIGINT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('student', 'admin')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);

-- Student space: module progress, final-test attempts and certificates.
CREATE TABLE IF NOT EXISTS module_progress (
  student_id   BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  module_key   TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, module_key)
);

CREATE TABLE IF NOT EXISTS test_attempts (
  id          BIGSERIAL PRIMARY KEY,
  student_id  BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,                   -- number of correct answers
  total       INTEGER NOT NULL,
  passed      BOOLEAN NOT NULL,
  answers     JSONB NOT NULL,                     -- question id -> chosen option index
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_attempts_student_idx ON test_attempts (student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS certificates (
  id          BIGSERIAL PRIMARY KEY,
  student_id  BIGINT NOT NULL UNIQUE REFERENCES students (id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,               -- RE-XXXXXX, the certificate number shown on LinkedIn
  full_name   TEXT NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audience for the back office (api/track.js). A visit is a random id kept in the browser tab
-- (sessionStorage, src/lib/presence.ts): no cookie, no IP address, and never linked to a registration or a person.
-- presence: the page each visit is on, refreshed every 60 s. Rows go before they are 48 h old (purge: api/track.js).
CREATE TABLE IF NOT EXISTS presence (
  mode        TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  visitor_id  TEXT NOT NULL,
  path        TEXT NOT NULL,                      -- location.pathname only: no query string, no hash, no certificate number, /- for an unknown page (/legal/- under /legal/)
  step        TEXT,                               -- form_1 to form_4 in the registration form, mollie when leaving to pay
  lang        TEXT,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, visitor_id)
);
CREATE INDEX IF NOT EXISTS presence_mode_updated_idx ON presence (mode, updated_at DESC);

-- funnel_events: the first time a visit reaches each step of the sales funnel. The event "paid" comes from
-- the Mollie webhook, keyed by a hash of the payment id (never by a visit). Rows go before they are 13 months old.
CREATE TABLE IF NOT EXISTS funnel_events (
  mode        TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  visitor_id  TEXT NOT NULL,
  event       TEXT NOT NULL,
  lang        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, visitor_id, event)
);
CREATE INDEX IF NOT EXISTS funnel_events_mode_event_idx ON funnel_events (mode, event, created_at);
