-- Owner review: PO payment rows whose movement_id does not match any existing movement.
-- Does not modify data.

SELECT
  pop.id AS purchase_order_payment_id,
  pop.purchase_order_id,
  pop.date,
  pop.amount,
  pop.currency,
  pop.pocket,
  pop.movement_id,
  pop.payment_id,
  pop.created_at
FROM public.purchase_order_payments pop
LEFT JOIN public.movements m
  ON m.id::text = TRIM(pop.movement_id)
WHERE pop.movement_id IS NOT NULL
  AND TRIM(pop.movement_id) <> ''
  AND m.id IS NULL
ORDER BY pop.created_at DESC;
