CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  department TEXT,
  vendor_id TEXT,
  vendor_name TEXT,
  vendor_address1 TEXT,
  vendor_city TEXT,
  vendor_state TEXT,
  vendor_zip TEXT,
  currency TEXT NOT NULL DEFAULT 'CAD',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Submitted',
  meta JSONB DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ NULL -- This is the only line added
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  description TEXT,
  qty NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED
);

CREATE TABLE IF NOT EXISTS po_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_created_at ON purchase_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_department ON purchase_orders (department);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders (vendor_name);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders (status);