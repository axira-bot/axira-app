-- Deal financial facts: amount + currency + rate_to_aed (AED per 1 unit of currency).
-- deal_expenses child rows; payments.rate_to_aed aligned with multiply-to-AED semantics.

-- ---------------------------------------------------------------------------
-- 1) deal_expenses + RLS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  expense_type text NOT NULL CHECK (
    expense_type IN (
      'shipping',
      'customs',
      'inspection',
      'recovery',
      'maintenance',
      'other',
      'purchase_supplier'
    )
  ),
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL CHECK (currency IN ('AED', 'USD', 'DZD', 'EUR')),
  rate_to_aed numeric NOT NULL CHECK (rate_to_aed > 0),
  notes text,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_expenses_deal_id ON public.deal_expenses(deal_id);

ALTER TABLE public.deal_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deal_expenses_select" ON public.deal_expenses;
DROP POLICY IF EXISTS "deal_expenses_insert" ON public.deal_expenses;
DROP POLICY IF EXISTS "deal_expenses_update" ON public.deal_expenses;
DROP POLICY IF EXISTS "deal_expenses_delete" ON public.deal_expenses;
DROP POLICY IF EXISTS "Investor deal_expenses select all" ON public.deal_expenses;
DROP POLICY IF EXISTS "deal_exparges_insert" ON public.deal_expenses;

CREATE POLICY "deal_expenses_select"
  ON public.deal_expenses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(COALESCE(up.role, ''))) = 'investor'
    )
    OR EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_expenses.deal_id
        AND (
          d.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles up2
            WHERE up2.id = auth.uid()
              AND LOWER(TRIM(up2.role)) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          )
          OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
        )
    )
  );

CREATE POLICY "deal_expenses_insert"
  ON public.deal_expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_expenses.deal_id
        AND (
          d.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          )
          OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
        )
    )
  );

CREATE POLICY "deal_expenses_update"
  ON public.deal_expenses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_expenses.deal_id
        AND (
          d.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          )
          OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_expenses.deal_id
        AND (
          d.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          )
          OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
        )
    )
  );

CREATE POLICY "deal_expenses_delete"
  ON public.deal_expenses
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_expenses.deal_id
        AND (
          d.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          )
          OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
          OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin', 'accountant')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2) deals: new fact columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS sale_amount numeric,
  ADD COLUMN IF NOT EXISTS sale_currency text,
  ADD COLUMN IF NOT EXISTS sale_rate_to_aed numeric,
  ADD COLUMN IF NOT EXISTS cost_amount numeric,
  ADD COLUMN IF NOT EXISTS cost_currency text,
  ADD COLUMN IF NOT EXISTS cost_rate_to_aed numeric,
  ADD COLUMN IF NOT EXISTS invoice_declared_amount numeric,
  ADD COLUMN IF NOT EXISTS invoice_declared_currency text,
  ADD COLUMN IF NOT EXISTS invoice_declared_usd numeric,
  ADD COLUMN IF NOT EXISTS financial_migration_status text,
  ADD COLUMN IF NOT EXISTS financial_migration_notes text;

-- ---------------------------------------------------------------------------
-- 3) Backfill sale (canonical list = sale_dzd)
-- ---------------------------------------------------------------------------
UPDATE public.deals d
SET
  sale_amount = COALESCE(d.sale_dzd, 0),
  sale_currency = 'DZD',
  sale_rate_to_aed = CASE
    WHEN COALESCE(d.sale_dzd, 0) > 0 AND COALESCE(d.sale_aed, 0) > 0
      THEN d.sale_aed / NULLIF(d.sale_dzd, 0)
    ELSE NULL
  END
WHERE d.sale_amount IS NULL;

-- ---------------------------------------------------------------------------
-- 4) Backfill cost (preorder without car)
-- ---------------------------------------------------------------------------
UPDATE public.deals d
SET
  cost_amount = COALESCE(d.source_cost, 0),
  cost_currency = COALESCE(NULLIF(TRIM(UPPER(COALESCE(d.source_currency::text, ''))), ''), 'AED'),
  cost_rate_to_aed = CASE
    WHEN COALESCE(d.source_cost, 0) <= 0 THEN 1
    WHEN COALESCE(NULLIF(TRIM(UPPER(COALESCE(d.source_currency::text, ''))), ''), 'AED') = 'AED' THEN 1
    ELSE GREATEST(COALESCE(d.source_rate_to_aed, 0), 0.0000001)
  END
WHERE d.car_id IS NULL
  AND d.cost_amount IS NULL;

-- ---------------------------------------------------------------------------
-- 4b) Backfill cost (stock deal with car; prefer deal_costs purchase when set)
-- ---------------------------------------------------------------------------
UPDATE public.deals d
SET
  cost_amount = CASE
    WHEN COALESCE(dc.purchase_cost, 0) > 0 THEN dc.purchase_cost
    ELSE COALESCE(c.purchase_price, d.source_cost, 0)
  END,
  cost_currency = COALESCE(
    NULLIF(TRIM(UPPER(COALESCE(dc.purchase_currency, ''))), ''),
    NULLIF(TRIM(UPPER(COALESCE(c.purchase_currency, ''))), ''),
    NULLIF(TRIM(UPPER(COALESCE(d.source_currency::text, ''))), ''),
    'AED'
  ),
  cost_rate_to_aed = CASE COALESCE(
      NULLIF(TRIM(UPPER(COALESCE(dc.purchase_currency, ''))), ''),
      NULLIF(TRIM(UPPER(COALESCE(c.purchase_currency, ''))), ''),
      NULLIF(TRIM(UPPER(COALESCE(d.source_currency::text, ''))), ''),
      'AED'
    )
    WHEN 'AED' THEN 1
    ELSE GREATEST(COALESCE(dc.purchase_rate, c.purchase_rate, d.source_rate_to_aed, 0.0000001), 0.0000001)
  END
FROM public.cars c
LEFT JOIN public.deal_costs dc ON dc.deal_id = d.id
WHERE d.car_id = c.id
  AND d.cost_amount IS NULL;

UPDATE public.deals d
SET
  cost_amount = 0,
  cost_currency = 'AED',
  cost_rate_to_aed = 1
WHERE d.cost_amount IS NULL;

-- ---------------------------------------------------------------------------
-- 5) Migrate legacy line items → deal_expenses (amounts were AED in UI)
-- ---------------------------------------------------------------------------
INSERT INTO public.deal_expenses (deal_id, expense_type, amount, currency, rate_to_aed)
SELECT d.id, v.expense_type, v.amt, 'AED'::text, 1::numeric
FROM public.deals d
LEFT JOIN public.deal_costs dc ON dc.deal_id = d.id
CROSS JOIN LATERAL (
  VALUES
    ('shipping', COALESCE(dc.shipping_cost, d.cost_shipping, 0)),
    ('customs', COALESCE(dc.customs_cost, 0)),
    ('inspection', COALESCE(dc.inspection_cost, d.cost_inspection, 0)),
    ('recovery', COALESCE(dc.recovery_cost, d.cost_recovery, 0)),
    ('maintenance', COALESCE(dc.maintenance_cost, d.cost_maintenance, 0)),
    ('other', COALESCE(dc.other_expenses, d.cost_other, 0))
) AS v(expense_type, amt)
WHERE v.amt > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.deal_expenses e
    WHERE e.deal_id = d.id
      AND e.expense_type = v.expense_type::text
  );

-- ---------------------------------------------------------------------------
-- 6) payments: rate_to_aed (AED per 1 unit of currency; AED row = 1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS rate_to_aed numeric;

UPDATE public.payments p
SET rate_to_aed = CASE
  WHEN UPPER(TRIM(COALESCE(p.currency, ''))) = 'AED' THEN 1
  WHEN COALESCE(p.amount, 0) > 0 AND p.aed_equivalent IS NOT NULL
    THEN p.aed_equivalent / NULLIF(p.amount, 0)
  WHEN COALESCE(p.amount, 0) > 0 AND COALESCE(p.rate_snapshot, 0) > 0
    THEN 1.0 / NULLIF(p.rate_snapshot, 0)
  ELSE NULL
END
WHERE p.rate_to_aed IS NULL;

UPDATE public.payments
SET rate_to_aed = 1
WHERE rate_to_aed IS NULL
  AND COALESCE(amount, 0) = 0;

UPDATE public.payments
SET rate_to_aed = 1
WHERE rate_to_aed IS NULL OR rate_to_aed <= 0;

ALTER TABLE public.payments
  ALTER COLUMN rate_to_aed SET NOT NULL,
  ALTER COLUMN rate_to_aed SET DEFAULT 1;

ALTER TABLE public.payments
  DROP COLUMN IF EXISTS rate_snapshot;

UPDATE public.payments p
SET aed_equivalent = ROUND((p.amount * p.rate_to_aed)::numeric, 6)
WHERE p.aed_equivalent IS DISTINCT FROM ROUND((p.amount * p.rate_to_aed)::numeric, 6);

-- ---------------------------------------------------------------------------
-- 7) deals: finalize NOT NULL / checks; drop legacy financial columns
--     sale_rate_to_aed may be NULL when sale_amount > 0 (flagged for review).
-- ---------------------------------------------------------------------------
UPDATE public.deals d
SET
  sale_amount = COALESCE(d.sale_amount, 0),
  sale_currency = COALESCE(NULLIF(TRIM(d.sale_currency), ''), 'DZD')
WHERE d.sale_amount IS NULL
  OR d.sale_currency IS NULL;

UPDATE public.deals d
SET sale_rate_to_aed = 1
WHERE COALESCE(d.sale_amount, 0) = 0
  AND (d.sale_rate_to_aed IS NULL OR d.sale_rate_to_aed <= 0);

UPDATE public.deals
SET financial_migration_status = COALESCE(financial_migration_status, 'ok');

UPDATE public.deals d
SET
  financial_migration_status = 'needs_review',
  financial_migration_notes = TRIM(
    CONCAT_WS(
      '; ',
      NULLIF(TRIM(COALESCE(d.financial_migration_notes, '')), ''),
      'sale_rate_missing'
    )
  )
WHERE d.sale_amount > 0
  AND (d.sale_rate_to_aed IS NULL OR d.sale_rate_to_aed <= 0);

ALTER TABLE public.deals
  ALTER COLUMN sale_amount SET NOT NULL,
  ALTER COLUMN sale_currency SET NOT NULL,
  ALTER COLUMN cost_amount SET NOT NULL,
  ALTER COLUMN cost_currency SET NOT NULL,
  ALTER COLUMN cost_rate_to_aed SET NOT NULL;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_sale_rate_check,
  DROP CONSTRAINT IF EXISTS deals_sale_currency_check,
  DROP CONSTRAINT IF EXISTS deals_cost_currency_check;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_sale_rate_check
    CHECK (sale_rate_to_aed IS NULL OR sale_rate_to_aed > 0),
  ADD CONSTRAINT deals_sale_currency_check
    CHECK (sale_currency IN ('AED', 'USD', 'DZD', 'EUR')),
  ADD CONSTRAINT deals_cost_currency_check
    CHECK (cost_currency IN ('AED', 'USD', 'DZD', 'EUR'));

ALTER TABLE public.deals
  DROP COLUMN IF EXISTS sale_dzd,
  DROP COLUMN IF EXISTS rate,
  DROP COLUMN IF EXISTS sale_aed,
  DROP COLUMN IF EXISTS sale_usd,
  DROP COLUMN IF EXISTS profit,
  DROP COLUMN IF EXISTS total_expenses,
  DROP COLUMN IF EXISTS margin_dzd,
  DROP COLUMN IF EXISTS margin_aed,
  DROP COLUMN IF EXISTS margin_pct,
  DROP COLUMN IF EXISTS cost_car,
  DROP COLUMN IF EXISTS cost_shipping,
  DROP COLUMN IF EXISTS cost_inspection,
  DROP COLUMN IF EXISTS cost_recovery,
  DROP COLUMN IF EXISTS cost_maintenance,
  DROP COLUMN IF EXISTS cost_other;

COMMENT ON COLUMN public.deals.sale_rate_to_aed IS 'AED per 1 unit of sale_currency (multiply amount to get AED).';
COMMENT ON COLUMN public.deals.cost_rate_to_aed IS 'AED per 1 unit of cost_currency (multiply amount to get AED).';
COMMENT ON COLUMN public.deal_expenses.rate_to_aed IS 'AED per 1 unit of currency (multiply amount to get AED).';
COMMENT ON COLUMN public.payments.rate_to_aed IS 'AED per 1 unit of currency (multiply amount to get AED).';