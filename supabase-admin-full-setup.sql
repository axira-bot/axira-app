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

CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries(status);
CREATE INDEX IF NOT EXISTS inquiries_created_at_idx ON inquiries(created_at DESC);

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
