-- Canonical cars.lifecycle_status values + RPC to bulk-update cars linked to a PO.

ALTER TABLE public.cars DROP CONSTRAINT IF EXISTS cars_lifecycle_status_check;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_lifecycle_status_check
  CHECK (
    lifecycle_status IN (
      'ORDERED',
      'IN_PRODUCTION',
      'AT_POL',
      'LOADED',
      'IN_TRANSIT',
      'AT_POD',
      'CLEARED',
      'DELIVERED'
    )
  );

CREATE OR REPLACE FUNCTION public.update_po_linked_cars_lifecycle(
  p_po_id uuid,
  p_car_ids uuid[],
  p_new_status text,
  p_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  cid uuid;
  v_count integer := 0;
BEGIN
  IF p_car_ids IS NULL OR array_length(p_car_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_CARS_SELECTED';
  END IF;

  IF p_new_status IS NULL OR p_new_status NOT IN (
      'ORDERED',
      'IN_PRODUCTION',
      'AT_POL',
      'LOADED',
      'IN_TRANSIT',
      'AT_POD',
      'CLEARED',
      'DELIVERED'
    ) THEN
    RAISE EXCEPTION 'INVALID_LIFECYCLE_STATUS';
  END IF;

  FOREACH cid IN ARRAY p_car_ids
  LOOP
    IF cid IS NULL THEN
      CONTINUE;
    END IF;
    PERFORM c.id
    FROM public.cars c
    WHERE c.id = cid AND c.purchase_order_id = p_po_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CAR_NOT_LINKED_TO_PO';
    END IF;
    PERFORM public.update_car_lifecycle_with_audit(cid, p_new_status, p_user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.update_po_linked_cars_lifecycle(uuid, uuid[], text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_po_linked_cars_lifecycle(uuid, uuid[], text, uuid) TO service_role;
