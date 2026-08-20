-- Customer-side schema (accounts, API keys, metering, subscriptions, alerts).
--
-- DELIBERATELY SEPARATE from the provenance ledger. The ledger is SQLite, is opened
-- READ-ONLY in production (PROTOCOL_RADAR_DB_READONLY=1) and is regenerated wholesale by
-- the observe -> snapshot cycle, so it can never hold customer state: a snapshot refresh
-- would destroy it. Everything below lives in Postgres and is never touched by the worker.
--
-- Conventions:
--  * Every timestamp is TIMESTAMPTZ and is supplied by the caller, never DEFAULT now(),
--    so tests stay deterministic (mirrors the injected-clock pattern used across src/lib).
--  * Soft-delete/revoke columns are nullable timestamps, never booleans, so the moment of
--    the state change is always recoverable.
--  * Secrets are stored as sha256 hashes only. No plaintext key or webhook secret is ever
--    written to a row that a SELECT could leak.

CREATE TABLE IF NOT EXISTS customer_schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id                 UUID PRIMARY KEY,
  -- Address as the user typed it, for display and outbound mail.
  email              TEXT NOT NULL,
  -- Lower-cased, trimmed form. UNIQUE lives here so "A@x.com" and "a@x.com" cannot both sign up.
  email_normalized   TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL,
  deleted_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- sha256 of the plaintext key. The plaintext is returned once at issuance and never stored.
  secret_hash  TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_account_idx ON api_keys (account_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY,
  account_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  -- Internal plan id ('free' | 'pro' | 'team'), resolved from the Stripe price.
  plan                   TEXT NOT NULL,
  -- Stripe subscription status, stored verbatim ('active', 'past_due', 'canceled', ...).
  status                 TEXT NOT NULL,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at             TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS subscriptions_account_idx ON subscriptions (account_id);

-- At most one entitling subscription per account. A partial unique index (rather than a
-- plain UNIQUE on account_id) lets historical canceled rows accumulate for audit while
-- making a double-charge state unrepresentable.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_per_account_idx
  ON subscriptions (account_id)
  WHERE status IN ('active', 'trialing', 'past_due');

CREATE TABLE IF NOT EXISTS usage_events (
  id          BIGSERIAL PRIMARY KEY,
  api_key_id  UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  -- 'free' (served from quota) | 'paid' (x402 settlement) | 'denied' (quota exhausted).
  decision    TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

-- The metering read is always "this key, this window", so the index leads with the key.
CREATE INDEX IF NOT EXISTS usage_events_key_time_idx
  ON usage_events (api_key_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id             UUID PRIMARY KEY,
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'email' | 'webhook' | 'slack'.
  channel        TEXT NOT NULL,
  -- Destination: mail address, webhook URL or Slack incoming-webhook URL.
  target         TEXT NOT NULL,
  -- NULL means "every monitored protocol".
  protocol_key   TEXT,
  -- sha256 of the shared secret used to sign webhook deliveries; NULL for mail.
  secret_hash    TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  -- Double opt-in: a subscription only receives traffic once this is set.
  verified_at    TIMESTAMPTZ,
  disabled_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alert_subscriptions_account_idx
  ON alert_subscriptions (account_id);

-- One subscription per (account, channel, target, scope). Ledger events fan out to
-- subscriptions, so a duplicate row would mean the customer is mailed twice per event.
CREATE UNIQUE INDEX IF NOT EXISTS alert_subscriptions_unique_target_idx
  ON alert_subscriptions (account_id, channel, target, COALESCE(protocol_key, '*'));

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id           BIGSERIAL PRIMARY KEY,
  alert_id     UUID NOT NULL REFERENCES alert_subscriptions(id) ON DELETE CASCADE,
  -- The ledger event's `seq` (events.seq in the SQLite ledger). Cross-store reference by
  -- value: there is no FK, because the two stores are intentionally independent.
  event_seq    BIGINT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL,
  ok           BOOLEAN NOT NULL,
  http_status  INTEGER,
  error        TEXT,
  -- Idempotency guard. The delivery loop may re-run (cron overlap, retry, redeploy); this
  -- makes "the same event delivered twice to the same subscriber" impossible at the storage
  -- layer instead of relying on the loop being careful.
  UNIQUE (alert_id, event_seq)
);

CREATE INDEX IF NOT EXISTS alert_deliveries_alert_idx ON alert_deliveries (alert_id);
