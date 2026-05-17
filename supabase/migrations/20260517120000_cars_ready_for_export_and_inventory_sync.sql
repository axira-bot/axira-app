-- READY_FOR_EXPORT on cars.lifecycle_status + RPC sync of inventory_lifecycle_status (no bulk retag of rows).

ALTER TABLE public.cars DROP CONSTRAINT IF EXISTS cars_lifecycle_status_check;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_lifecycle_status_check
  CHECK (
    lifecycle_status IN (
      'ORDERED',
      'IN_PRODUCTION',
      'READY_FOR_EXPORT',
      'AT_POL',
      'LOADED',
      'IN_TRANSIT',
      'AT_POD',
      'CLEARED',
      'DELIVERED'
    )
  );

CREATE OR REPLACE FUNCTION public.lifecycle_status_to_inventory_lifecycle(p_lifecycle text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(trim(both from coalesce(p_lifecycle::text, '')))
    WHEN 'ORDERED' THEN 'INCOMING'
    WHEN 'IN_PRODUCTION' THEN 'INCOMING'
    WHEN 'READY_FOR_EXPORT' THEN 'IN_STOCK'
    WHEN 'AT_POL' THEN 'IN_TRANSIT'
    WHEN 'LOADED' THEN 'IN_TRANSIT'
    WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
    WHEN 'AT_POD' THEN 'IN_STOCK'
    WHEN 'CLEARED' THEN 'IN_STOCK'
    WHEN 'DELIVERED' THEN 'DELIVERED'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.update_car_lifecycle_with_audit(
  p_car_id uuid,
  p_new_status text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_old text;
  v_old_inv text;
  v_new_inv text;
BEGIN
  SELECT lifecycle_status, inventory_lifecycle_status
  INTO v_old, v_old_inv
  FROM public.cars
  WHERE id = p_car_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Car not found for id %', p_car_id;
  END IF;

  IF v_old IS DISTINCT FROM p_new_status THEN
    v_new_inv := public.lifecycle_status_to_inventory_lifecycle(p_new_status);

    UPDATE public.cars
    SET lifecycle_status = p_new_status,
        lifecycle_status_updated_at = now(),
        lifecycle_status_updated_by = p_user_id,
        inventory_lifecycle_status = v_new_inv
    WHERE id = p_car_id;

    INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
    VALUES (p_car_id, 'lifecycle_status', v_old, p_new_status, p_user_id);

    SELECT inventory_lifecycle_status INTO v_new_inv FROM public.cars WHERE id = p_car_id;

    IF v_new_inv IS NOT NULL AND v_old_inv IS DISTINCT FROM v_new_inv THEN
      INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
      VALUES (p_car_id, 'inventory_lifecycle_status', v_old_inv, v_new_inv, p_user_id);
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_inventory_cars_lifecycle(
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
      'READY_FOR_EXPORT',
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
    WHERE c.id = cid
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CAR_NOT_FOUND';
    END IF;
    PERFORM public.update_car_lifecycle_with_audit(cid, p_new_status, p_user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

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
      'READY_FOR_EXPORT',
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

REVOKE ALL ON FUNCTION public.update_inventory_cars_lifecycle(uuid[], text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_inventory_cars_lifecycle(uuid[], text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.update_po_linked_cars_lifecycle(uuid, uuid[], text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_po_linked_cars_lifecycle(uuid, uuid[], text, uuid) TO service_role;
