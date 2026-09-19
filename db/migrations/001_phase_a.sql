CREATE TABLE games (
  id text PRIMARY KEY,
  away_team text NOT NULL,
  home_team text NOT NULL,
  starts_at timestamptz NOT NULL
);

CREATE TABLE markets (
  ticker text PRIMARY KEY,
  series_ticker text NOT NULL,
  game_id text REFERENCES games(id),
  yes_outcome text NOT NULL,
  status text NOT NULL,
  rules_url text NOT NULL,
  observed_at timestamptz NOT NULL
);

CREATE TABLE market_rules_versions (
  ticker text NOT NULL REFERENCES markets(ticker),
  version text NOT NULL,
  rules_primary text NOT NULL,
  rules_secondary text NOT NULL,
  tie_settlement_cents integer,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (ticker, version)
);

CREATE TABLE market_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker text NOT NULL REFERENCES markets(ticker),
  as_of timestamptz NOT NULL,
  orderbook jsonb NOT NULL,
  input_hash text NOT NULL UNIQUE
);

CREATE TABLE probability_estimates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  outcome text NOT NULL,
  probability_bps integer NOT NULL CHECK (probability_bps BETWEEN 0 AND 10000),
  lower_bound_bps integer NOT NULL CHECK (lower_bound_bps BETWEEN 0 AND 10000),
  source text NOT NULL,
  model_version text NOT NULL,
  as_of timestamptz NOT NULL
);

CREATE TABLE strategy_config_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker text NOT NULL REFERENCES markets(ticker),
  action text NOT NULL CHECK (action IN ('TRADE', 'NO_TRADE')),
  reasons jsonb NOT NULL,
  input_snapshot_hash text NOT NULL,
  quote_depth jsonb,
  expected_fee_cents numeric(12, 4),
  created_at timestamptz NOT NULL
);

CREATE TABLE job_runs (
  id text PRIMARY KEY,
  job_type text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  error text
);

CREATE INDEX market_snapshots_ticker_as_of_idx ON market_snapshots (ticker, as_of DESC);
CREATE INDEX probability_estimates_game_as_of_idx ON probability_estimates (game_id, as_of DESC);
CREATE INDEX decisions_ticker_created_at_idx ON decisions (ticker, created_at DESC);
