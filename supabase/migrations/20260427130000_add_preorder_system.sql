-- Axira Pre-Order System (API-first enforcement)
-- Additive migration: safe for existing stock-sales flow.

-- ---------------------------------------------------------------------
-- 1) Supplier master + supplier catalog
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text,
  contact_name text,
  contact_phone text,
  default_currency text CHECK (default_currency IN ('USD', 'AED')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_supplier ON supplier_catalog(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_active ON supplier_catalog(active);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_brand_model ON supplier_catalog(brand, model);

-- ---------------------------------------------------------------------
-- 2) Deals extensions for pre-order lifecycle
-- ---------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_deals_source ON deals(source);
CREATE INDEX IF NOT EXISTS idx_deals_lifecycle_status ON deals(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_deals_custom_spec_signature ON deals(custom_spec_signature);

-- ---------------------------------------------------------------------
-- 3) Custom pre-order specification details
-- ---------------------------------------------------------------------
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_custom_specs_supplier_id ON deal_custom_specs(supplier_id);
CREATE INDEX IF NOT EXISTS idx_deal_custom_specs_confirmed ON deal_custom_specs(supplier_confirmed);

-- ---------------------------------------------------------------------
-- 4) Cars extensions for inventory lifecycle linking
-- ---------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_cars_inventory_lifecycle_status ON cars(inventory_lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_cars_linked_deal_id ON cars(linked_deal_id);

-- ---------------------------------------------------------------------
-- 5) Clients extensions (identity details for pre-orders)
-- ---------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS passport_number text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS algeria_address text;

CREATE INDEX IF NOT EXISTS idx_clients_passport_number ON clients(passport_number);

-- ---------------------------------------------------------------------
-- 6) Payments extensions for event ledger snapshots
-- ---------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_payments_kind ON payments(kind);
CREATE INDEX IF NOT EXISTS idx_payments_supplier_id ON payments(supplier_id);
