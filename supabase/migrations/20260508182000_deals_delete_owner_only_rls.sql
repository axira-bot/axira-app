-- Phase A: allow DELETE on deals only for owner-like roles.
-- Manager intentionally excluded.

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_delete_owner_only" ON public.deals;

CREATE POLICY "deals_delete_owner_only"
  ON public.deals
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(COALESCE(up.role, ''))) IN ('owner','admin','super_admin')
    )
    OR LOWER(COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '')) IN ('owner','admin','super_admin')
    OR LOWER(COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '')) IN ('owner','admin','super_admin')
  );
