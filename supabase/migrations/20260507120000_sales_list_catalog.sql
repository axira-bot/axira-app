-- Sales list: AT_PORT lifecycle, per-car list commercial fields, order-on-demand catalog, deal FK, RBAC defaults.

-- ---------------------------------------------------------------------
-- 1) cars.inventory_lifecycle_status: add AT_PORT (replace check constraint)
-- ---------------------------------------------------------------------
ALTER TABLE public.cars DROP CONSTRAINT IF EXISTS cars_inventory_lifecycle_status_check;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_inventory_lifecycle_status_check
  CHECK (
    inventory_lifecycle_status IS NULL
    OR inventory_lifecycle_status IN (
      'IN_STOCK',
      'INCOMING',
      'IN_TRANSIT',
      'AT_PORT',
      'ARRIVED',
      'READY_TO_SHIP',
      'DELIVERED'
    )
  );

ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS sales_lead_time_days integer;
ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS sales_deposit_dzd numeric;
ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS sales_internal_note text;
ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS sales_cost_estimate_dzd numeric;

COMMENT ON COLUMN public.cars.sales_lead_time_days IS 'Owner/manager: lead time shown on Algeria sales list.';
COMMENT ON COLUMN public.cars.sales_deposit_dzd IS 'Owner/manager: required deposit (DZD) for sales list.';
COMMENT ON COLUMN public.cars.sales_internal_note IS 'Manager/owner: margin/cost guidance (not for staff on sales list API).';
COMMENT ON COLUMN public.cars.sales_cost_estimate_dzd IS 'Optional cost estimate in DZD for margin display.';

-- ---------------------------------------------------------------------
-- 2) sales_catalog_entries (order on demand; owner-priced DZD list)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_catalog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  model text NOT NULL,
  year integer,
  color_options text[] NOT NULL DEFAULT '{}',
  trim text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_reference text,
  sale_price_dzd numeric NOT NULL CHECK (sale_price_dzd >= 0),
  lead_time_days integer NOT NULL CHECK (lead_time_days >= 0),
  deposit_amount_dzd numeric NOT NULL CHECK (deposit_amount_dzd >= 0),
  photos text[] DEFAULT '{}',
  internal_note text,
  cost_estimate_dzd numeric,
  margin_note text,
  buyer_responsibilities_note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_catalog_entries_active ON public.sales_catalog_entries(active);
CREATE INDEX IF NOT EXISTS idx_sales_catalog_entries_brand_model ON public.sales_catalog_entries(brand, model);

ALTER TABLE public.sales_catalog_entries ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read active rows only (direct client reads); admin API bypasses RLS.
DROP POLICY IF EXISTS "sales_catalog_entries_select_active" ON public.sales_catalog_entries;
CREATE POLICY "sales_catalog_entries_select_active"
  ON public.sales_catalog_entries
  FOR SELECT
  TO authenticated
  USING (active = true);

COMMENT ON TABLE public.sales_catalog_entries IS 'Algeria sales list: owner-priced vehicles available to order on demand (not owned inventory).';

-- ---------------------------------------------------------------------
-- 3) deals.sales_catalog_entry_id
-- ---------------------------------------------------------------------
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS sales_catalog_entry_id uuid REFERENCES public.sales_catalog_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_sales_catalog_entry_id ON public.deals(sales_catalog_entry_id);

-- ---------------------------------------------------------------------
-- 4) role_feature_defaults: sales_list, sales_catalog_admin
-- ---------------------------------------------------------------------
INSERT INTO public.role_feature_defaults (role, feature_key, allowed) VALUES
('owner','sales_list',true),('owner','sales_catalog_admin',true),
('admin','sales_list',true),('admin','sales_catalog_admin',true),
('super_admin','sales_list',true),('super_admin','sales_catalog_admin',true),
('manager','sales_list',true),('manager','sales_catalog_admin',false),
('staff','sales_list',true),('staff','sales_catalog_admin',false),
('accountant','sales_list',true),('accountant','sales_catalog_admin',false),
('investor','sales_list',false),('investor','sales_catalog_admin',false)
ON CONFLICT (role, feature_key) DO UPDATE SET allowed = EXCLUDED.allowed;
