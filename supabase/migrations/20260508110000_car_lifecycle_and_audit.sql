-- Phase 1: car lifecycle field + VIN validation metadata + car audit log

-- 1) cars: lifecycle_status + VIN validation metadata
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'ORDERED',
  ADD COLUMN IF NOT EXISTS lifecycle_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_status_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vin_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS vin_validated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill lifecycle_status for existing rows
-- Mapping (approved by product):
-- - available/in_stock -> CLEARED
-- - sold/delivered     -> DELIVERED
-- - otherwise          -> ORDERED
UPDATE public.cars
SET lifecycle_status =
  CASE
    WHEN lower(coalesce(status, '')) IN ('available', 'in_stock') THEN 'CLEARED'
    WHEN lower(coalesce(status, '')) IN ('sold', 'delivered') THEN 'DELIVERED'
    ELSE 'ORDERED'
  END
WHERE lifecycle_status IS NULL OR lifecycle_status = 'ORDERED';

-- Helper query to review mapping outcome BEFORE production rollout:
-- SELECT lifecycle_status, COUNT(*) AS count_per_status
-- FROM public.cars
-- GROUP BY lifecycle_status
-- ORDER BY count_per_status DESC;

-- 2) car_audit_log: append-only audit for car field changes
CREATE TABLE IF NOT EXISTS public.car_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE INDEX IF NOT EXISTS idx_car_audit_log_car_id_changed_at
  ON public.car_audit_log (car_id, changed_at DESC);

ALTER TABLE public.car_audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: Owner / Admin / Super admin / Manager
DROP POLICY IF EXISTS "car_audit_log_select_owner_manager" ON public.car_audit_log;
CREATE POLICY "car_audit_log_select_owner_manager"
  ON public.car_audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(COALESCE(up.role, ''))) IN ('owner', 'admin', 'super_admin', 'manager')
    )
    OR LOWER(COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '')) IN ('owner', 'admin', 'super_admin', 'manager')
    OR LOWER(COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '')) IN ('owner', 'admin', 'super_admin', 'manager')
  );

-- INSERT: service role / server-side only (no authenticated inserts)
DROP POLICY IF EXISTS "car_audit_log_insert_authenticated" ON public.car_audit_log;
CREATE POLICY "car_audit_log_insert_authenticated"
  ON public.car_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- No UPDATE/DELETE policies => append-only from app perspective

-- 3) Atomic lifecycle_status update + audit (for future use by API)
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
BEGIN
  SELECT lifecycle_status INTO v_old
  FROM public.cars
  WHERE id = p_car_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Car not found for id %', p_car_id;
  END IF;

  IF v_old IS DISTINCT FROM p_new_status THEN
    UPDATE public.cars
    SET lifecycle_status = p_new_status,
        lifecycle_status_updated_at = now(),
        lifecycle_status_updated_by = p_user_id
    WHERE id = p_car_id;

    INSERT INTO public.car_audit_log (car_id, field_name, old_value, new_value, changed_by)
    VALUES (p_car_id, 'lifecycle_status', v_old, p_new_status, p_user_id);
  END IF;
END;
$$;

