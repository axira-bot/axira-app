-- When a movement row is deleted (e.g. from Movements UI), remove linked PO payment + supplier_payment
-- so purchase_order_payments does not stay orphaned.

CREATE OR REPLACE FUNCTION public.cleanup_po_payment_when_movement_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT TRIM(pop.payment_id) AS payment_id
    FROM public.purchase_order_payments pop
    WHERE pop.movement_id IS NOT NULL
      AND TRIM(pop.movement_id) = OLD.id::text
      AND TRIM(COALESCE(pop.payment_id, '')) <> ''
  LOOP
    BEGIN
      DELETE FROM public.payments WHERE id = r.payment_id::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        NULL;
    END;
  END LOOP;

  DELETE FROM public.purchase_order_payments
  WHERE movement_id IS NOT NULL
    AND TRIM(movement_id) = OLD.id::text;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_po_payment_on_movement_delete ON public.movements;
CREATE TRIGGER trg_cleanup_po_payment_on_movement_delete
  AFTER DELETE ON public.movements
  FOR EACH ROW
  EXECUTE PROCEDURE public.cleanup_po_payment_when_movement_deleted();

COMMENT ON FUNCTION public.cleanup_po_payment_when_movement_deleted() IS
  'Deletes purchase_order_payments and linked payments rows when a PO-linked movement is removed.';
