CREATE OR REPLACE FUNCTION public.save_contract_pregen_data(
  p_deal_id uuid,
  p_payment_id uuid,
  p_mode text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_deal record;
  v_features text[];
BEGIN
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  IF coalesce(trim(p_payload->>'vehicle_options'), '') <> '' THEN
    v_features := regexp_split_to_array(p_payload->>'vehicle_options', '\s*,\s*');
  ELSE
    v_features := ARRAY[]::text[];
  END IF;

  IF v_deal.client_id IS NOT NULL THEN
    UPDATE public.clients
       SET name = NULLIF(trim(p_payload->>'client_full_name'), ''),
           passport_number = NULLIF(trim(p_payload->>'client_id_number'), ''),
           phone = NULLIF(trim(p_payload->>'client_phone'), ''),
           email = NULLIF(trim(p_payload->>'client_email'), ''),
           algeria_address = NULLIF(trim(p_payload->>'client_address'), '')
     WHERE id = v_deal.client_id;
  END IF;

  UPDATE public.deals
     SET client_name = NULLIF(trim(p_payload->>'client_full_name'), ''),
         sale_amount = COALESCE((p_payload->>'total_price_dzd')::numeric, sale_amount)
   WHERE id = p_deal_id;

  IF v_deal.car_id IS NOT NULL THEN
    UPDATE public.cars
       SET brand = COALESCE(NULLIF(trim(p_payload->>'vehicle_brand'), ''), brand),
           model = COALESCE(NULLIF(trim(p_payload->>'vehicle_model'), ''), model),
           year = COALESCE((p_payload->>'vehicle_year')::int, year),
           grade = NULLIF(trim(p_payload->>'vehicle_trim'), ''),
           color = NULLIF(trim(p_payload->>'vehicle_exterior_color'), ''),
           mileage = COALESCE((p_payload->>'vehicle_mileage')::numeric, mileage),
           vin = NULLIF(trim(p_payload->>'vehicle_vin'), ''),
           engine = NULLIF(trim(p_payload->>'vehicle_engine'), ''),
           transmission = NULLIF(trim(p_payload->>'vehicle_transmission'), ''),
           fuel_type = NULLIF(trim(p_payload->>'vehicle_fuel'), ''),
           country_of_origin = NULLIF(trim(p_payload->>'vehicle_origin'), ''),
           condition = NULLIF(trim(p_payload->>'vehicle_condition'), ''),
           features = CASE WHEN array_length(v_features, 1) IS NULL THEN features ELSE v_features END,
           body_issues = NULLIF(trim(p_payload->>'vehicle_disclosures'), ''),
           sales_deposit_dzd = COALESCE((p_payload->>'deposit_amount_dzd')::numeric, sales_deposit_dzd),
           sales_lead_time_days = COALESCE((p_payload->>'lead_time_days')::int, sales_lead_time_days)
     WHERE id = v_deal.car_id;
  ELSE
    INSERT INTO public.deal_custom_specs (
      deal_id, brand, model, year, color, trim, options, updated_at
    )
    VALUES (
      p_deal_id,
      NULLIF(trim(p_payload->>'vehicle_brand'), ''),
      NULLIF(trim(p_payload->>'vehicle_model'), ''),
      (p_payload->>'vehicle_year')::int,
      NULLIF(trim(p_payload->>'vehicle_exterior_color'), ''),
      NULLIF(trim(p_payload->>'vehicle_trim'), ''),
      NULLIF(trim(p_payload->>'vehicle_options'), ''),
      now()
    )
    ON CONFLICT (deal_id)
    DO UPDATE SET
      brand = EXCLUDED.brand,
      model = EXCLUDED.model,
      year = EXCLUDED.year,
      color = EXCLUDED.color,
      trim = EXCLUDED.trim,
      options = EXCLUDED.options,
      updated_at = now();
  END IF;

  IF lower(coalesce(p_mode, '')) = 'receipt' THEN
    IF p_payment_id IS NULL THEN
      RAISE EXCEPTION 'payment_id is required for receipt mode';
    END IF;
    UPDATE public.payments
       SET amount = COALESCE((p_payload->>'amount_dzd')::numeric, amount),
           dzd = COALESCE((p_payload->>'amount_dzd')::numeric, dzd),
           rate_snapshot = COALESCE((p_payload->>'exchange_rate')::numeric, rate_snapshot),
           rate_to_aed = COALESCE((p_payload->>'exchange_rate')::numeric, rate_to_aed),
           rate = COALESCE((p_payload->>'exchange_rate')::numeric, rate)
     WHERE id = p_payment_id
       AND deal_id = p_deal_id;
  END IF;
END;
$$;
