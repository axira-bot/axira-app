-- One-time backfill: set legacy inventory_lifecycle_status from canonical lifecycle_status
-- where inventory_lifecycle_status is NULL (sales list and PO flows rely on legacy field).
-- Does not overwrite existing inventory_lifecycle_status.

UPDATE public.cars AS c
SET inventory_lifecycle_status = CASE upper(trim(both from c.lifecycle_status::text))
  WHEN 'ORDERED' THEN 'INCOMING'
  WHEN 'IN_PRODUCTION' THEN 'INCOMING'
  WHEN 'AT_POL' THEN 'IN_TRANSIT'
  WHEN 'LOADED' THEN 'IN_TRANSIT'
  WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
  WHEN 'AT_POD' THEN 'IN_STOCK'
  WHEN 'CLEARED' THEN 'IN_STOCK'
  WHEN 'DELIVERED' THEN 'DELIVERED'
END
WHERE c.inventory_lifecycle_status IS NULL
  AND c.lifecycle_status IS NOT NULL
  AND upper(trim(both from c.lifecycle_status::text)) IN (
    'ORDERED',
    'IN_PRODUCTION',
    'AT_POL',
    'LOADED',
    'IN_TRANSIT',
    'AT_POD',
    'CLEARED',
    'DELIVERED'
  );
