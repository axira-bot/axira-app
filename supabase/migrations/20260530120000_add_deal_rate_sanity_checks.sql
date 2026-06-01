-- Phase 1: rate sanity CHECK constraints (NOT VALID — existing rows exempt until validated).
-- Flag pre-order deals created before pre-order rate fix for manual review.

-- ---------------------------------------------------------------------------
-- deals.cost_rate_to_aed
-- ---------------------------------------------------------------------------
ALTER TABLE public.deals
  ADD CONSTRAINT deals_cost_rate_usd_eur_sane
  CHECK (
    cost_currency IS NULL
    OR cost_currency NOT IN ('USD', 'EUR')
    OR (cost_rate_to_aed >= 0.1 AND cost_rate_to_aed <= 50)
  ) NOT VALID;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_cost_rate_dzd_sane
  CHECK (
    cost_currency IS NULL
    OR cost_currency <> 'DZD'
    OR (cost_rate_to_aed >= 0.001 AND cost_rate_to_aed <= 1)
  ) NOT VALID;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_cost_rate_aed_sane
  CHECK (
    cost_currency IS NULL
    OR cost_currency <> 'AED'
    OR cost_rate_to_aed = 1
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- deals.sale_rate_to_aed
-- ---------------------------------------------------------------------------
ALTER TABLE public.deals
  ADD CONSTRAINT deals_sale_rate_usd_eur_sane
  CHECK (
    sale_rate_to_aed IS NULL
    OR sale_currency IS NULL
    OR sale_currency NOT IN ('USD', 'EUR')
    OR (sale_rate_to_aed >= 0.1 AND sale_rate_to_aed <= 50)
  ) NOT VALID;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_sale_rate_dzd_sane
  CHECK (
    sale_rate_to_aed IS NULL
    OR sale_currency IS NULL
    OR sale_currency <> 'DZD'
    OR (sale_rate_to_aed >= 0.001 AND sale_rate_to_aed <= 1)
  ) NOT VALID;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_sale_rate_aed_sane
  CHECK (
    sale_rate_to_aed IS NULL
    OR sale_currency IS NULL
    OR sale_currency <> 'AED'
    OR sale_rate_to_aed = 1
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- deal_expenses.rate_to_aed
-- ---------------------------------------------------------------------------
ALTER TABLE public.deal_expenses
  ADD CONSTRAINT deal_expenses_rate_usd_eur_sane
  CHECK (
    currency NOT IN ('USD', 'EUR')
    OR (rate_to_aed >= 0.1 AND rate_to_aed <= 50)
  ) NOT VALID;

ALTER TABLE public.deal_expenses
  ADD CONSTRAINT deal_expenses_rate_dzd_sane
  CHECK (
    currency <> 'DZD'
    OR (rate_to_aed >= 0.001 AND rate_to_aed <= 1)
  ) NOT VALID;

ALTER TABLE public.deal_expenses
  ADD CONSTRAINT deal_expenses_rate_aed_sane
  CHECK (
    currency <> 'AED'
    OR rate_to_aed = 1
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- Flag legacy pre-order deals (rates may be wrong before Phase 1 fix)
-- ---------------------------------------------------------------------------
UPDATE public.deals
SET
  financial_migration_status = 'needs_review',
  financial_migration_notes = COALESCE(financial_migration_notes, '')
    || ' | Auto-flagged: pre-Phase1 pre-order, rates may be incorrect'
WHERE source IN ('PRE_ORDER_CATALOG', 'PRE_ORDER_CUSTOM')
  AND (financial_migration_status IS NULL OR financial_migration_status = 'ok');
