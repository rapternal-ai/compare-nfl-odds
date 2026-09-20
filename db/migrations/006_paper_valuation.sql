ALTER TABLE paper_orders DROP CONSTRAINT IF EXISTS paper_orders_side_check;
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_side_check CHECK (side IN ('buy', 'sell'));
ALTER TABLE paper_fills ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'buy' CHECK (side IN ('buy', 'sell', 'settlement'));
ALTER TABLE paper_positions ALTER COLUMN cost_basis_cents TYPE numeric(14, 4);
ALTER TABLE paper_positions ALTER COLUMN total_fees_cents TYPE numeric(14, 4);

CREATE TABLE IF NOT EXISTS paper_realized_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker text NOT NULL REFERENCES markets(ticker),
  event_type text NOT NULL CHECK (event_type IN ('exit', 'settlement')),
  quantity integer NOT NULL CHECK (quantity > 0),
  proceeds_cents numeric(14, 4) NOT NULL,
  cost_basis_cents numeric(14, 4) NOT NULL,
  fee_cents numeric(14, 4) NOT NULL DEFAULT 0,
  pnl_cents numeric(14, 4) NOT NULL,
  settlement_value_cents integer,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_realized_events_created_at_idx ON paper_realized_events (created_at DESC);
