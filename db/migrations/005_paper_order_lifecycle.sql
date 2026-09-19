ALTER TABLE paper_orders DROP CONSTRAINT IF EXISTS paper_orders_status_check;
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_status_check CHECK (status IN ('resting', 'partial', 'filled', 'cancelled', 'expired'));
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS quote_as_of timestamptz;
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE paper_fills ADD COLUMN IF NOT EXISTS order_id text REFERENCES paper_orders(id);

CREATE INDEX IF NOT EXISTS paper_orders_status_expires_idx ON paper_orders (status, expires_at);
CREATE INDEX IF NOT EXISTS paper_fills_order_id_idx ON paper_fills (order_id);
