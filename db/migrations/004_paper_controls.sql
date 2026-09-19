ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS decision_key text;
ALTER TABLE paper_fills ALTER COLUMN price_cents TYPE numeric(12, 4);
CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_decision_key_idx ON paper_orders (decision_key) WHERE decision_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  new_entries_paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id, new_entries_paused)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS risk_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker text,
  decision_key text,
  event_type text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS risk_events_created_at_idx ON risk_events (created_at DESC);
