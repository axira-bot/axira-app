-- Axira Purchase Orders: standalone permanent bootstrap
-- Run this file in Supabase SQL Editor when PO tables are missing.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE,
  supplier_id uuid,
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
  created_by uuid,
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
  car_id uuid NOT NULL,
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
  movement_id text,
  payment_id text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cars ADD COLUMN IF NOT EXISTS purchase_order_id uuid;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_payments_po ON purchase_order_payments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_cars_purchase_order_id ON cars(purchase_order_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'po_deal_eligibility') THEN
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('po_deal_eligibility', 'in_transit_or_arrived', now());
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='suppliers'
  ) THEN
    BEGIN
      ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='cars'
  ) THEN
    BEGIN
      ALTER TABLE purchase_order_item_cars
      ADD CONSTRAINT purchase_order_item_cars_car_id_fkey
      FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    BEGIN
      ALTER TABLE cars
      ADD CONSTRAINT cars_purchase_order_id_fkey
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    BEGIN
      ALTER TABLE cars
      ADD CONSTRAINT cars_purchase_order_item_id_fkey
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
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
  SELECT COALESCE(SUM(total_cost), 0) INTO v_total
  FROM purchase_order_items
  WHERE purchase_order_id = target_po;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
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
DECLARE target_po uuid;
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
DECLARE target_po uuid;
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
    WHERE schemaname='public' AND tablename='purchase_orders' AND policyname='PO read for staff manager owner'
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
    WHERE schemaname='public' AND tablename='purchase_orders' AND policyname='PO write manager owner'
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
    WHERE schemaname='public' AND tablename='purchase_order_items' AND policyname='PO items read staff manager owner'
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
    WHERE schemaname='public' AND tablename='purchase_order_items' AND policyname='PO items write manager owner'
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
    WHERE schemaname='public' AND tablename='purchase_order_payments' AND policyname='PO payments read staff manager owner'
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
    WHERE schemaname='public' AND tablename='purchase_order_payments' AND policyname='PO payments write manager owner'
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

SELECT pg_notify('pgrst', 'reload schema');
