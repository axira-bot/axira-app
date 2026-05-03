-- Align public.payments with app code: inserts use rate_to_aed (AED per 1 unit).
-- Safe if 20260503140000_deal_financial_facts.sql already ran (mostly no-op).

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS rate_to_aed numeric;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payments'
      AND column_name = 'rate_snapshot'
  ) THEN
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
  ELSE
    UPDATE public.payments p
    SET rate_to_aed = CASE
      WHEN UPPER(TRIM(COALESCE(p.currency, ''))) = 'AED' THEN 1
      WHEN COALESCE(p.amount, 0) > 0 AND p.aed_equivalent IS NOT NULL
        THEN p.aed_equivalent / NULLIF(p.amount, 0)
      ELSE NULL
    END
    WHERE p.rate_to_aed IS NULL;
  END IF;
END $$;

UPDATE public.payments
SET rate_to_aed = 1
WHERE rate_to_aed IS NULL
  AND COALESCE(amount, 0) = 0;

UPDATE public.payments
SET rate_to_aed = 1
WHERE rate_to_aed IS NULL OR rate_to_aed <= 0;

ALTER TABLE public.payments
  ALTER COLUMN rate_to_aed SET DEFAULT 1;

ALTER TABLE public.payments
  ALTER COLUMN rate_to_aed SET NOT NULL;

UPDATE public.payments p
SET aed_equivalent = ROUND((p.amount * p.rate_to_aed)::numeric, 6)
WHERE p.aed_equivalent IS DISTINCT FROM ROUND((p.amount * p.rate_to_aed)::numeric, 6);

ALTER TABLE public.payments
  DROP COLUMN IF EXISTS rate_snapshot;

COMMENT ON COLUMN public.payments.rate_to_aed IS 'AED per 1 unit of currency (multiply amount to get AED).';
