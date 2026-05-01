-- Align deals visibility policy:
-- owner/manager-like roles can see/edit all deals, staff can only manage their own.
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff own deals select" ON public.deals;
DROP POLICY IF EXISTS "Staff own deals insert" ON public.deals;
DROP POLICY IF EXISTS "Staff own deals update" ON public.deals;

CREATE POLICY "Staff own deals select"
  ON public.deals
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin')
    )
    OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
    OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
  );

CREATE POLICY "Staff own deals insert"
  ON public.deals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin')
    )
    OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
    OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
  );

CREATE POLICY "Staff own deals update"
  ON public.deals
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin')
    )
    OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
    OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin')
    )
    OR LOWER(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
    OR LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN ('owner', 'manager', 'admin', 'super_admin')
  );
