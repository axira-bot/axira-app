-- Ensure rents CRUD works for owner/manager-like roles.
ALTER TABLE public.rents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Rents debug read any auth" ON public.rents;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rents' AND policyname = 'Rents owner manager all'
  ) THEN
    CREATE POLICY "Rents owner manager all"
      ON public.rents FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_profiles up
          WHERE up.id = auth.uid()
            AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_profiles up
          WHERE up.id = auth.uid()
            AND LOWER(TRIM(up.role)) IN ('owner', 'manager', 'admin', 'super_admin')
        )
      );
  END IF;
END$$;
