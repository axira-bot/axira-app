-- Axira Admin App: Full idempotent Supabase setup
-- Run this file in Supabase SQL Editor (safe to re-run).
-- It creates/patches all admin-support tables and columns referenced by the app.

-- ---------------------------------------------------------------------
-- 0) Employees / Investors domain
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('Sales Staff', 'Manager', 'Accountant', 'Operations')),
  phone text,
  email text,
  base_salary numeric DEFAULT 0,
  commission_per_deal numeric DEFAULT 0,
  commission_per_managed_deal numeric DEFAULT 0,
  start_date date,
  notes text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_currency text DEFAULT 'AED';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_code_unique
  ON employees(employee_code)
  WHERE employee_code IS NOT NULL;

-- Backfill missing employee codes deterministically for existing rows.
WITH missing AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY EXTRACT(YEAR FROM COALESCE(created_at, now()))
      ORDER BY COALESCE(created_at, now()), id
    ) AS seq,
    EXTRACT(YEAR FROM COALESCE(created_at, now()))::int AS yr
  FROM employees
  WHERE employee_code IS NULL OR employee_code = ''
)
UPDATE employees e
SET employee_code = 'EMP-' || missing.yr || '-' || LPAD(missing.seq::text, 4, '0')
FROM missing
WHERE e.id = missing.id;

-- Permanent DB-level auto-generation for future inserts.
CREATE OR REPLACE FUNCTION set_employee_code_if_missing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  yr int;
  seq int;
BEGIN
  IF NEW.employee_code IS NOT NULL AND BTRIM(NEW.employee_code) <> '' THEN
    RETURN NEW;
  END IF;

  yr := EXTRACT(YEAR FROM COALESCE(NEW.created_at, now()))::int;
  SELECT COALESCE(MAX(NULLIF(SUBSTRING(employee_code FROM 10), '')::int), 0) + 1
  INTO seq
  FROM employees
  WHERE employee_code LIKE ('EMP-' || yr || '-%');

  NEW.employee_code := 'EMP-' || yr || '-' || LPAD(seq::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_employee_code_if_missing ON employees;
CREATE TRIGGER trg_set_employee_code_if_missing
BEFORE INSERT ON employees
FOR EACH ROW
EXECUTE FUNCTION set_employee_code_if_missing();

CREATE TABLE IF NOT EXISTS commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  amount numeric DEFAULT 0,
  type text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  month text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS currency text DEFAULT 'DZD';
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS rate_snapshot numeric;
UPDATE commissions SET currency = 'DZD' WHERE currency IS NULL;

CREATE TABLE IF NOT EXISTS investors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  investment_amount numeric DEFAULT 0,
  currency text DEFAULT 'AED',
  rate numeric DEFAULT 1,
  investment_aed numeric DEFAULT 0,
  profit_share_percent numeric DEFAULT 0,
  investment_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investor_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid REFERENCES investors(id) ON DELETE CASCADE,
  month text,
  total_profit numeric DEFAULT 0,
  investor_share numeric DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS handled_by uuid REFERENCES employees(id);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS handled_by_name text;

-- ---------------------------------------------------------------------
-- 1) User profiles (auth + role bridge)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  role text DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff', 'investor', 'accountant')),
  employee_id uuid REFERENCES employees(id),
  investor_id uuid REFERENCES investors(id),
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2) Core admin logging/support tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  description text NOT NULL,
  amount numeric,
  currency text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity);

CREATE TABLE IF NOT EXISTS rents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL,
  annual_amount numeric NOT NULL,
  monthly_amount numeric GENERATED ALWAYS AS (annual_amount / 12) STORED,
  daily_amount numeric GENERATED ALWAYS AS (annual_amount / 365) STORED,
  currency text DEFAULT 'AED',
  start_date date NOT NULL,
  end_date date,
  pocket text,
  payment_frequency text DEFAULT 'monthly',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3) Existing table extensions used by admin logic
-- ---------------------------------------------------------------------
ALTER TABLE movements ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS sale_usd numeric;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS country_of_origin text;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS photos text[];
ALTER TABLE cars ADD COLUMN IF NOT EXISTS supplier_paid numeric DEFAULT 0;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS supplier_owed numeric DEFAULT 0;

-- ---------------------------------------------------------------------
-- 4) Inquiries (public site submissions shown in admin)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inquiries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  city text,
  car_id uuid REFERENCES cars(id) ON DELETE SET NULL,
  car_label text,
  message text,
  source text DEFAULT 'public_website',
  status text DEFAULT 'new',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS source_channel text DEFAULT 'public_website';
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS whatsapp_ref text;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS assigned_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries(status);
CREATE INDEX IF NOT EXISTS inquiries_created_at_idx ON inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_assigned_employee_idx ON inquiries(assigned_employee_id);

ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'inquiries' AND policyname = 'Public can submit inquiries'
  ) THEN
    CREATE POLICY "Public can submit inquiries"
      ON inquiries FOR INSERT TO anon WITH CHECK (true);
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  client_phone text,
  client_passport text,
  car_brand text NOT NULL,
  car_model text NOT NULL,
  car_year integer,
  car_color text,
  car_vin text,
  country_of_origin text,
  amount_usd numeric NOT NULL DEFAULT 0,
  export_to text DEFAULT 'Algeria',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_documents_created_at_idx ON client_documents(created_at DESC);

-- ---------------------------------------------------------------------
-- 6) Feature permissions (owner-controlled visibility matrix)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_feature_defaults (
  role text NOT NULL,
  feature_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (role, feature_key)
);

CREATE TABLE IF NOT EXISTS user_feature_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_user_feature_permissions_user_id
  ON user_feature_permissions(user_id);

INSERT INTO role_feature_defaults (role, feature_key, allowed)
SELECT *
FROM (
  VALUES
    ('owner','dashboard',true),('owner','activity',true),('owner','inventory',true),('owner','deals',true),
    ('owner','containers',true),('owner','movements',true),('owner','transfers',true),('owner','debts',true),
    ('owner','employees',true),('owner','payroll',true),('owner','investors',true),('owner','reports',true),
    ('owner','clients',true),('owner','inquiries',true),('owner','admin_users',true),
    ('manager','dashboard',true),('manager','activity',true),('manager','inventory',true),('manager','deals',true),
    ('manager','containers',true),('manager','movements',true),('manager','debts',true),('manager','payroll',true),
    ('manager','reports',true),('manager','clients',true),('manager','inquiries',true),
    ('staff','inventory',true),('staff','deals',true),('staff','clients',true),('staff','inquiries',true),
    ('accountant','activity',true),('accountant','movements',true),('accountant','reports',true),('accountant','payroll',true),
    ('investor','investors',true)
) AS defaults(role, feature_key, allowed)
ON CONFLICT (role, feature_key) DO UPDATE
SET allowed = EXCLUDED.allowed;

-- ---------------------------------------------------------------------
-- 5) Pre-order system (supplier catalog + deal lifecycle)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text,
  contact_name text,
  contact_phone text,
  default_currency text CHECK (default_currency IN ('USD', 'AED')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  brand text NOT NULL,
  model text NOT NULL,
  year integer,
  trim text,
  color_options text[] DEFAULT '{}',
  base_cost numeric NOT NULL DEFAULT 0,
  base_currency text NOT NULL CHECK (base_currency IN ('USD', 'AED')),
  lead_time_days integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lifecycle_status text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS cancellation_note text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS agreed_delivery_date date;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS inventory_car_id uuid REFERENCES cars(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_cost numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_currency text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_rate_to_dzd numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_rate_to_aed numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS margin_dzd numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS margin_aed numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS margin_pct numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS custom_spec_signature text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_source_check'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_source_check
      CHECK (source IS NULL OR source IN ('STOCK', 'PRE_ORDER_CATALOG', 'PRE_ORDER_CUSTOM'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_lifecycle_status_check'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_lifecycle_status_check
      CHECK (
        lifecycle_status IS NULL OR lifecycle_status IN ('PRE_ORDER', 'ORDERED', 'SHIPPED', 'ARRIVED', 'CLOSED', 'CANCELLED')
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_cancellation_reason_check'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_cancellation_reason_check
      CHECK (
        cancellation_reason IS NULL OR cancellation_reason IN ('customer_cancelled', 'supplier_unavailable', 'other')
      );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS deal_custom_specs (
  deal_id uuid PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_tbd boolean NOT NULL DEFAULT false,
  brand text,
  model text,
  year integer,
  color text,
  trim text,
  options text,
  estimated_cost numeric,
  estimated_currency text CHECK (estimated_currency IN ('USD', 'AED')),
  supplier_confirmation_required boolean NOT NULL DEFAULT true,
  supplier_confirmed boolean NOT NULL DEFAULT false,
  supplier_confirmed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  supplier_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cars ADD COLUMN IF NOT EXISTS inventory_lifecycle_status text;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS linked_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS supplier_catalog_id uuid REFERENCES supplier_catalog(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cars_inventory_lifecycle_status_check'
  ) THEN
    ALTER TABLE cars
      ADD CONSTRAINT cars_inventory_lifecycle_status_check
      CHECK (
        inventory_lifecycle_status IS NULL OR inventory_lifecycle_status IN ('IN_STOCK', 'INCOMING', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED')
      );
  END IF;
END$$;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS passport_number text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS algeria_address text;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS rate_snapshot numeric;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS aed_equivalent numeric;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pocket text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS meta jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_kind_check'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_kind_check
      CHECK (
        kind IS NULL OR kind IN ('customer_deposit', 'customer_settlement', 'supplier_payment', 'refund', 'forfeit')
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'inquiries' AND policyname = 'Authenticated can read inquiries'
  ) THEN
    CREATE POLICY "Authenticated can read inquiries"
      ON inquiries FOR SELECT TO authenticated USING (true);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'inquiries' AND policyname = 'Authenticated can update inquiries'
  ) THEN
    CREATE POLICY "Authenticated can update inquiries"
      ON inquiries FOR UPDATE TO authenticated USING (true);
  END IF;
END$$;
