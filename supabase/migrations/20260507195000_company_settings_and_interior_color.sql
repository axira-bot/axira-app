ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS interior_color text;

CREATE TABLE IF NOT EXISTS public.company_settings (
  id text PRIMARY KEY DEFAULT 'default',
  fze_license_number text NOT NULL DEFAULT '',
  fze_address text NOT NULL DEFAULT '',
  fze_representative text NOT NULL DEFAULT '',
  fze_position text NOT NULL DEFAULT '',
  auto_license_number text NOT NULL DEFAULT '',
  auto_address text NOT NULL DEFAULT '',
  auto_representative text NOT NULL DEFAULT '',
  auto_position text NOT NULL DEFAULT '',
  fze_phone text NOT NULL DEFAULT '',
  fze_email text NOT NULL DEFAULT '',
  auto_phone text NOT NULL DEFAULT '',
  auto_email text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT company_settings_singleton CHECK (id = 'default')
);

INSERT INTO public.company_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_settings_owner_select" ON public.company_settings;
CREATE POLICY "company_settings_owner_select"
  ON public.company_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role, '')) = 'owner'
    )
  );

DROP POLICY IF EXISTS "company_settings_owner_update" ON public.company_settings;
CREATE POLICY "company_settings_owner_update"
  ON public.company_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role, '')) = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role, '')) = 'owner'
    )
  );
