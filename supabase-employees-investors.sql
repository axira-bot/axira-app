-- Run this in Supabase SQL Editor.
-- Requires: deals table must already exist.

-- 1. Employees
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

-- 2. Commissions (references deals – ensure deals table exists)
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

-- 3. Investors
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

-- 4. Investor returns
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

-- 5. Add salary currency to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_currency text DEFAULT 'AED';

-- 6. Add employee columns to deals (run after employees exists)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS handled_by uuid REFERENCES employees(id);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS handled_by_name text;
