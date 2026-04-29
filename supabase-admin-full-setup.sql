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
  invoice_date date,
  agreement_date date,
  amount_usd numeric NOT NULL DEFAULT 0,
  export_to text DEFAULT 'Algeria',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS invoice_date date;
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS agreement_date date;
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
    ('owner','clients',true),('owner','inquiries',true),('owner','purchase_orders',true),('owner','admin_users',true),
    ('manager','dashboard',true),('manager','activity',true),('manager','inventory',true),('manager','deals',true),
    ('manager','containers',true),('manager','movements',true),('manager','debts',true),('manager','payroll',true),('manager','purchase_orders',true),
    ('manager','reports',true),('manager','clients',true),('manager','inquiries',true),
    ('staff','inventory',true),('staff','deals',true),('staff','clients',true),('staff','inquiries',true),('staff','purchase_orders',true),
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
ALTER TABLE deals ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pending_completion boolean NOT NULL DEFAULT false;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS completion_notes text;
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

-- ---------------------------------------------------------------------
-- 8) Bulk purchase orders
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  source_market text CHECK (source_market IN ('china', 'dubai', 'other')),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'AED', 'DZD', 'EUR')),
  fx_rate_to_aed numeric,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'partial_received', 'received', 'cancelled')),
  expected_arrival_date date,
  ordered_at date DEFAULT CURRENT_DATE,
  notes text,
  total_cost numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  supplier_owed numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  brand text NOT NULL,
  model text NOT NULL,
  year integer,
  color text,
  vin text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  inventory_status text NOT NULL DEFAULT 'in_transit' CHECK (inventory_status IN ('in_transit', 'arrived', 'available', 'sold')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_item_cars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (purchase_order_item_id, car_id),
  UNIQUE (car_id)
);

CREATE TABLE IF NOT EXISTS purchase_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'AED', 'DZD', 'EUR')),
  rate_snapshot numeric,
  aed_equivalent numeric,
  pocket text,
  method text,
  notes text,
  -- Keep these as text to avoid cross-project type mismatch (uuid vs bigint ids).
  movement_id text,
  payment_id text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cars ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid REFERENCES purchase_order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_payments_po ON purchase_order_payments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_cars_purchase_order_id ON cars(purchase_order_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_settings WHERE key = 'po_deal_eligibility'
  ) THEN
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('po_deal_eligibility', 'in_transit_or_arrived', now());
  END IF;
END$$;

CREATE OR REPLACE FUNCTION recompute_purchase_order_totals(target_po uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric := 0;
  v_paid numeric := 0;
BEGIN
  SELECT COALESCE(SUM(total_cost), 0)
  INTO v_total
  FROM purchase_order_items
  WHERE purchase_order_id = target_po;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_paid
  FROM purchase_order_payments
  WHERE purchase_order_id = target_po;

  UPDATE purchase_orders
  SET total_cost = v_total,
      paid_amount = v_paid,
      supplier_owed = v_total - v_paid,
      updated_at = now()
  WHERE id = target_po;
END;
$$;

CREATE OR REPLACE FUNCTION set_purchase_order_item_total_cost()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total_cost := COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_cost, 0);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_purchase_order_item_total_cost ON purchase_order_items;
CREATE TRIGGER trg_set_purchase_order_item_total_cost
BEFORE INSERT OR UPDATE ON purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION set_purchase_order_item_total_cost();

CREATE OR REPLACE FUNCTION sync_purchase_order_totals_from_items()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_po uuid;
BEGIN
  target_po := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  PERFORM recompute_purchase_order_totals(target_po);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_purchase_order_totals_from_items ON purchase_order_items;
CREATE TRIGGER trg_sync_purchase_order_totals_from_items
AFTER INSERT OR UPDATE OR DELETE ON purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION sync_purchase_order_totals_from_items();

CREATE OR REPLACE FUNCTION sync_purchase_order_totals_from_payments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_po uuid;
BEGIN
  target_po := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  PERFORM recompute_purchase_order_totals(target_po);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_purchase_order_totals_from_payments ON purchase_order_payments;
CREATE TRIGGER trg_sync_purchase_order_totals_from_payments
AFTER INSERT OR UPDATE OR DELETE ON purchase_order_payments
FOR EACH ROW
EXECUTE FUNCTION sync_purchase_order_totals_from_payments();

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_item_cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_orders' AND policyname = 'PO read for staff manager owner'
  ) THEN
    CREATE POLICY "PO read for staff manager owner"
      ON purchase_orders FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager', 'staff')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_orders' AND policyname = 'PO write manager owner'
  ) THEN
    CREATE POLICY "PO write manager owner"
      ON purchase_orders FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_order_items' AND policyname = 'PO items read staff manager owner'
  ) THEN
    CREATE POLICY "PO items read staff manager owner"
      ON purchase_order_items FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager', 'staff')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_order_items' AND policyname = 'PO items write manager owner'
  ) THEN
    CREATE POLICY "PO items write manager owner"
      ON purchase_order_items FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_order_item_cars' AND policyname = 'PO item cars read staff manager owner'
  ) THEN
    CREATE POLICY "PO item cars read staff manager owner"
      ON purchase_order_item_cars FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager', 'staff')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_order_item_cars' AND policyname = 'PO item cars write manager owner'
  ) THEN
    CREATE POLICY "PO item cars write manager owner"
      ON purchase_order_item_cars FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_order_payments' AND policyname = 'PO payments read staff manager owner'
  ) THEN
    CREATE POLICY "PO payments read staff manager owner"
      ON purchase_order_payments FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager', 'staff')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_order_payments' AND policyname = 'PO payments write manager owner'
  ) THEN
    CREATE POLICY "PO payments write manager owner"
      ON purchase_order_payments FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
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

-- ---------------------------------------------------------------------
-- 7) Deals security and internal cost segregation
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_costs (
  deal_id uuid PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  purchase_cost numeric,
  purchase_currency text CHECK (purchase_currency IN ('AED', 'USD', 'DZD', 'EUR')),
  purchase_rate numeric,
  shipping_cost numeric DEFAULT 0,
  customs_cost numeric DEFAULT 0,
  inspection_cost numeric DEFAULT 0,
  recovery_cost numeric DEFAULT 0,
  maintenance_cost numeric DEFAULT 0,
  other_expenses numeric DEFAULT 0,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  internal_notes text,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('sale_change', 'car_change', 'client_change', 'cancel_request')),
  requested_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  manager_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_created_by ON deals(created_by);
CREATE INDEX IF NOT EXISTS idx_deals_pending_completion ON deals(pending_completion);
CREATE INDEX IF NOT EXISTS idx_deal_edit_requests_deal_id ON deal_edit_requests(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_edit_requests_status ON deal_edit_requests(status);

INSERT INTO deal_costs (
  deal_id,
  purchase_cost,
  purchase_currency,
  purchase_rate,
  shipping_cost,
  customs_cost,
  inspection_cost,
  recovery_cost,
  maintenance_cost,
  other_expenses,
  updated_at
)
SELECT
  d.id,
  d.cost_car,
  'AED',
  NULL,
  COALESCE(d.cost_shipping, 0),
  0,
  COALESCE(d.cost_inspection, 0),
  COALESCE(d.cost_recovery, 0),
  COALESCE(d.cost_maintenance, 0),
  COALESCE(d.cost_other, 0),
  now()
FROM deals d
ON CONFLICT (deal_id) DO NOTHING;

DO $$
DECLARE
  fallback_owner uuid;
BEGIN
  SELECT id
  INTO fallback_owner
  FROM user_profiles
  WHERE role IN ('owner', 'manager')
  ORDER BY
    CASE WHEN role = 'owner' THEN 0 ELSE 1 END,
    created_at ASC NULLS LAST
  LIMIT 1;

  IF fallback_owner IS NOT NULL THEN
    UPDATE deals
    SET created_by = fallback_owner
    WHERE created_by IS NULL;
  END IF;
END$$;

UPDATE deals SET pending_completion = false WHERE pending_completion IS NULL;

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_edit_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deals' AND policyname = 'Staff own deals select'
  ) THEN
    CREATE POLICY "Staff own deals select"
      ON deals FOR SELECT TO authenticated
      USING (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deals' AND policyname = 'Staff own deals insert'
  ) THEN
    CREATE POLICY "Staff own deals insert"
      ON deals FOR INSERT TO authenticated
      WITH CHECK (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deals' AND policyname = 'Staff own deals update'
  ) THEN
    CREATE POLICY "Staff own deals update"
      ON deals FOR UPDATE TO authenticated
      USING (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      )
      WITH CHECK (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deal_costs' AND policyname = 'Managers owner only deal costs'
  ) THEN
    CREATE POLICY "Managers owner only deal costs"
      ON deal_costs FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deal_edit_requests' AND policyname = 'Deal edit requests create'
  ) THEN
    CREATE POLICY "Deal edit requests create"
      ON deal_edit_requests FOR INSERT TO authenticated
      WITH CHECK (
        requested_by = auth.uid()
        AND EXISTS (
          SELECT 1 FROM deals d
          WHERE d.id = deal_id
            AND (
              d.created_by = auth.uid()
              OR EXISTS (
                SELECT 1 FROM user_profiles up
                WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
              )
            )
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deal_edit_requests' AND policyname = 'Deal edit requests select'
  ) THEN
    CREATE POLICY "Deal edit requests select"
      ON deal_edit_requests FOR SELECT TO authenticated
      USING (
        requested_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'deal_edit_requests' AND policyname = 'Deal edit requests manager review'
  ) THEN
    CREATE POLICY "Deal edit requests manager review"
      ON deal_edit_requests FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('owner', 'manager')
        )
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
