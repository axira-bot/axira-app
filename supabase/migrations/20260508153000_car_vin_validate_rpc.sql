-- Phase 2: transactional first-time VIN validation + audit + deals bump;
-- separate owner-only override RPC.

CREATE OR REPLACE FUNCTION public.is_iso_vin(p_vin text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT length(trim(both FROM upper(COALESCE(p_vin, '')))) = 17
    AND trim(both FROM upper(COALESCE(p_vin, ''))) ~ '^[A-HJ-NPR-Z0-9]{17}$';
$$;


CREATE OR REPLACE FUNCTION public.validate_car_vin_with_audit(
  p_car_id uuid,
  p_vin text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized text;
  v_old_vin text;
  v_was_validated timestamptz;
  v_low_status text;
BEGIN
  v_normalized := trim(both FROM upper(COALESCE(p_vin, '')));

  IF NOT public.is_iso_vin(v_normalized) THEN
    RAISE EXCEPTION 'INVALID_VIN_FORMAT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT c.vin, c.vin_validated_at, lower(trim(both FROM coalesce(c.status, '')))
  INTO v_old_vin, v_was_validated, v_low_status
  FROM public.cars c
  WHERE c.id = p_car_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_was_validated IS NOT NULL THEN
    RAISE EXCEPTION 'VIN_ALREADY_VALIDATED'
      USING ERRCODE = 'P0003';
  END IF;

  UPDATE public.cars c
  SET vin = v_normalized,
      vin_validated_at = now(),
      vin_validated_by = p_user_id,
      inventory_lifecycle_status = CASE
        WHEN v_low_status IN ('available', 'sold', 'delivered')
        THEN COALESCE(c.inventory_lifecycle_status, 'IN_STOCK')
        ELSE 'READY_TO_SHIP'::text
      END,
      status = CASE
        WHEN v_low_status IN ('available', 'sold', 'delivered') THEN c.status
        ELSE 'in_transit'
      END
  WHERE c.id = p_car_id;

  INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
  VALUES (
    p_car_id,
    'vin',
    v_old_vin,
    v_normalized,
    p_user_id
  );

  UPDATE public.deals d
  SET status = 'pending'::text
  WHERE (d.car_id = p_car_id OR d.inventory_car_id = p_car_id)
    AND d.status IS NOT NULL
    AND trim(both FROM lower(d.status::text)) IN ('pending', 'ordered', 'processing');
END;
$$;


CREATE OR REPLACE FUNCTION public.owner_override_car_vin_with_audit(
  p_car_id uuid,
  p_new_vin text,
  p_user_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized text;
  v_old_vin text;
  v_was_validated timestamptz;
BEGIN
  v_normalized := trim(both FROM upper(COALESCE(p_new_vin, '')));

  IF NOT public.is_iso_vin(v_normalized) THEN
    RAISE EXCEPTION 'INVALID_VIN_FORMAT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT c.vin, c.vin_validated_at
  INTO v_old_vin, v_was_validated
  FROM public.cars c
  WHERE c.id = p_car_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_was_validated IS NULL THEN
    RAISE EXCEPTION 'NOT_YET_VALIDATED'
      USING ERRCODE = 'P0004';
  END IF;

  IF v_old_vin IS NOT DISTINCT FROM v_normalized THEN
    RETURN;
  END IF;

  UPDATE public.cars c
  SET vin = v_normalized
  WHERE c.id = p_car_id;

  INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by, reason)
  VALUES (
    p_car_id,
    'vin',
    v_old_vin,
    v_normalized,
    p_user_id,
    NULLIF(trim(both FROM COALESCE(p_reason, '')), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_iso_vin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_car_vin_with_audit(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_override_car_vin_with_audit(uuid, text, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_iso_vin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_car_vin_with_audit(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_override_car_vin_with_audit(uuid, text, uuid, text) TO service_role;
