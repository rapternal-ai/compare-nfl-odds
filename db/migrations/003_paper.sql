CREATE TABLE IF NOT EXISTS paper_positions (
  ticker text PRIMARY KEY REFERENCES markets(ticker),
  quantity integer NOT NULL CHECK (quantity > 0),
  cost_basis_cents integer NOT NULL,
  total_fees_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_fills (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker text NOT NULL REFERENCES markets(ticker),
  price_cents integer NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  fee_cents integer NOT NULL DEFAULT 0,
  filled_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id text PRIMARY KEY,
  ticker text NOT NULL REFERENCES markets(ticker),
  side text NOT NULL CHECK (side IN ('buy')),
  limit_price_cents integer NOT NULL,
  requested_quantity integer NOT NULL,
  filled_quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('filled', 'partial', 'cancelled')),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_config_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cash_cents integer NOT NULL,
  at_risk_cents integer NOT NULL DEFAULT 0,
  realized_pnl_cents integer NOT NULL DEFAULT 0,
  mode text NOT NULL CHECK (mode IN ('paper', 'demo', 'live')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX paper_fills_ticker_idx ON paper_fills (ticker);
CREATE INDEX paper_orders_ticker_idx ON paper_orders (ticker);
CREATE INDEX account_snapshots_created_at_idx ON account_snapshots (created_at DESC);
