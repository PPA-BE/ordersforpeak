CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  meta JSONB DEFAULT '{}'::jsonb
);