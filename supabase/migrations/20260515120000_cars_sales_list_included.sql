-- Sales list opt-in: overrides supplier-without-PO block when true (see /api/sales-list).
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS sales_list_included boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cars.sales_list_included IS
  'When true, overrides supplier listing without purchase_order_id for sales list visibility; price, lifecycle, sold, and linked_deal rules still apply per API.';

-- Backfill open inventory with a sale price so existing visibility is easy to tighten manually.
UPDATE public.cars c
SET sales_list_included = true
WHERE COALESCE(LOWER(TRIM(c.status)), '') <> 'sold'
  AND c.linked_deal_id IS NULL
  AND COALESCE(c.sale_price_dzd, 0) > 0;
