-- Transactional PO line update + mirror brand/model/year/color/grade onto linked inventory cars + car_audit_log.

CREATE OR REPLACE FUNCTION public.purchase_order_item_update_sync_linked_cars(
  p_po_id uuid,
  p_item_id uuid,
  p_fields jsonb,
  p_user_id uuid
)
RETURNS public.purchase_order_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.purchase_order_items;
  r_car RECORD;
  v_inv text;
  v_q jsonb := coalesce(p_fields, '{}'::jsonb);
BEGIN
  IF v_q = '{}'::jsonb THEN
    RAISE EXCEPTION 'EMPTY_PAYLOAD';
  END IF;

  SELECT *
  INTO v_item
  FROM public.purchase_order_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO_ITEM_NOT_FOUND';
  END IF;

  IF v_item.purchase_order_id IS DISTINCT FROM p_po_id THEN
    RAISE EXCEPTION 'PO_ITEM_PO_MISMATCH';
  END IF;

  -- Merge allowed PO item columns (PATCH surface; line VIN not handled here)
  IF v_q ? 'brand' THEN
    IF trim(both from coalesce(v_q ->> 'brand', '')) = '' THEN
      RAISE EXCEPTION 'BRAND_REQUIRED';
    END IF;
    v_item.brand := trim(both from (v_q ->> 'brand'));
  END IF;

  IF v_q ? 'model' THEN
    IF trim(both from coalesce(v_q ->> 'model', '')) = '' THEN
      RAISE EXCEPTION 'MODEL_REQUIRED';
    END IF;
    v_item.model := trim(both from (v_q ->> 'model'));
  END IF;

  IF v_q ? 'year' THEN
    IF jsonb_typeof(v_q -> 'year') = 'null' THEN
      v_item.year := NULL;
    ELSE
      v_item.year := (trim(both from (v_q ->> 'year')))::integer;
    END IF;
  END IF;

  IF v_q ? 'color' THEN
    IF jsonb_typeof(v_q -> 'color') = 'null' THEN
      v_item.color := NULL;
    ELSE
      v_item.color := nullif(trim(both from coalesce(v_q ->> 'color', '')), '');
    END IF;
  END IF;

  IF v_q ? 'grade' THEN
    IF jsonb_typeof(v_q -> 'grade') = 'null' THEN
      v_item.grade := NULL;
    ELSE
      v_item.grade := nullif(trim(both from coalesce(v_q ->> 'grade', '')), '');
    END IF;
  END IF;

  IF v_q ? 'quantity' THEN
    v_item.quantity := greatest(1, coalesce((trim(both from (v_q ->> 'quantity')))::integer, 1));
  END IF;

  IF v_q ? 'unit_cost' THEN
    v_item.unit_cost := coalesce((trim(both from (v_q ->> 'unit_cost')))::numeric, 0);
  END IF;

  IF v_q ? 'inventory_status' THEN
    v_inv := lower(trim(both from coalesce(v_q ->> 'inventory_status', '')));
    IF v_inv IS NULL OR v_inv NOT IN ('in_transit', 'arrived', 'available', 'sold') THEN
      RAISE EXCEPTION 'INVALID_INVENTORY_STATUS';
    END IF;
    v_item.inventory_status := v_inv;
  END IF;

  IF v_q ? 'notes' THEN
    IF jsonb_typeof(v_q -> 'notes') = 'null' THEN
      v_item.notes := NULL;
    ELSE
      v_item.notes := nullif(trim(both from coalesce(v_q ->> 'notes', '')), '');
    END IF;
  END IF;

  v_item.total_cost := v_item.quantity * v_item.unit_cost;
  v_item.updated_at := now();

  UPDATE public.purchase_order_items
  SET
    brand = v_item.brand,
    model = v_item.model,
    year = v_item.year,
    color = v_item.color,
    grade = v_item.grade,
    quantity = v_item.quantity,
    unit_cost = v_item.unit_cost,
    inventory_status = v_item.inventory_status,
    notes = v_item.notes,
    total_cost = v_item.total_cost,
    updated_at = v_item.updated_at
  WHERE id = p_item_id
    AND purchase_order_id = p_po_id
  RETURNING * INTO v_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO_ITEM_UPDATE_FAILED';
  END IF;

  FOR r_car IN
    SELECT
      c.id AS car_id,
      c.brand AS car_brand,
      c.model AS car_model,
      c.year AS car_year,
      c.color AS car_color,
      c.grade AS car_grade
    FROM public.purchase_order_item_cars poic
    INNER JOIN public.cars c ON c.id = poic.car_id
    WHERE poic.purchase_order_item_id = p_item_id
    ORDER BY poic.created_at ASC
  LOOP
    IF v_q ? 'brand' THEN
      IF r_car.car_brand IS DISTINCT FROM v_item.brand THEN
        INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
        VALUES (
          r_car.car_id,
          'brand',
          r_car.car_brand,
          coalesce(v_item.brand::text, ''),
          p_user_id
        );
      END IF;
    END IF;

    IF v_q ? 'model' THEN
      IF r_car.car_model IS DISTINCT FROM v_item.model THEN
        INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
        VALUES (
          r_car.car_id,
          'model',
          r_car.car_model,
          coalesce(v_item.model::text, ''),
          p_user_id
        );
      END IF;
    END IF;

    IF v_q ? 'year' THEN
      IF r_car.car_year IS DISTINCT FROM v_item.year THEN
        INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
        VALUES (
          r_car.car_id,
          'year',
          r_car.car_year::text,
          coalesce(v_item.year::text, ''),
          p_user_id
        );
      END IF;
    END IF;

    IF v_q ? 'color' THEN
      IF r_car.car_color IS DISTINCT FROM v_item.color THEN
        INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
        VALUES (
          r_car.car_id,
          'color',
          r_car.car_color,
          coalesce(v_item.color::text, ''),
          p_user_id
        );
      END IF;
    END IF;

    IF v_q ? 'grade' THEN
      IF r_car.car_grade IS DISTINCT FROM v_item.grade THEN
        INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
        VALUES (
          r_car.car_id,
          'grade',
          r_car.car_grade,
          coalesce(v_item.grade::text, ''),
          p_user_id
        );
      END IF;
    END IF;

    UPDATE public.cars c
    SET
      brand = CASE WHEN v_q ? 'brand' THEN v_item.brand ELSE c.brand END,
      model = CASE WHEN v_q ? 'model' THEN v_item.model ELSE c.model END,
      year = CASE WHEN v_q ? 'year' THEN v_item.year ELSE c.year END,
      color = CASE WHEN v_q ? 'color' THEN v_item.color ELSE c.color END,
      grade = CASE WHEN v_q ? 'grade' THEN v_item.grade ELSE c.grade END
    WHERE c.id = r_car.car_id;
  END LOOP;

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_order_item_update_sync_linked_cars(uuid, uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_order_item_update_sync_linked_cars(uuid, uuid, jsonb, uuid) TO service_role;
