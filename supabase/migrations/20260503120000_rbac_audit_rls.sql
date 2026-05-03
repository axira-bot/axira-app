-- RBAC: canonical role_feature_defaults, activity_log RLS, investor deal read access
-- Safe to re-run: upserts defaults; replaces policies by name.

-- ---------------------------------------------------------------------------
-- 1) Role feature defaults (explicit cell for every role × feature)
-- ---------------------------------------------------------------------------
INSERT INTO public.role_feature_defaults (role, feature_key, allowed) VALUES
-- owner
('owner','dashboard',true),('owner','activity',false),('owner','inventory',true),('owner','deals',true),
('owner','containers',true),('owner','movements',true),('owner','transfers',true),('owner','debts',true),
('owner','employees',true),('owner','payroll',true),('owner','investors',true),('owner','reports',true),
('owner','clients',true),('owner','inquiries',true),('owner','purchase_orders',true),('owner','suppliers',true),
('owner','audit_log',true),('owner','admin_users',true),
-- admin
('admin','dashboard',true),('admin','activity',false),('admin','inventory',true),('admin','deals',true),
('admin','containers',true),('admin','movements',true),('admin','transfers',true),('admin','debts',true),
('admin','employees',true),('admin','payroll',true),('admin','investors',true),('admin','reports',true),
('admin','clients',true),('admin','inquiries',true),('admin','purchase_orders',true),('admin','suppliers',true),
('admin','audit_log',true),('admin','admin_users',true),
-- super_admin
('super_admin','dashboard',true),('super_admin','activity',false),('super_admin','inventory',true),('super_admin','deals',true),
('super_admin','containers',true),('super_admin','movements',true),('super_admin','transfers',true),('super_admin','debts',true),
('super_admin','employees',true),('super_admin','payroll',true),('super_admin','investors',true),('super_admin','reports',true),
('super_admin','clients',true),('super_admin','inquiries',true),('super_admin','purchase_orders',true),('super_admin','suppliers',true),
('super_admin','audit_log',true),('super_admin','admin_users',true),
-- manager
('manager','dashboard',true),('manager','activity',true),('manager','inventory',true),('manager','deals',true),
('manager','containers',true),('manager','movements',true),('manager','transfers',true),('manager','debts',true),
('manager','employees',true),('manager','payroll',false),('manager','investors',false),('manager','reports',true),
('manager','clients',true),('manager','inquiries',true),('manager','purchase_orders',false),('manager','suppliers',false),
('manager','audit_log',false),('manager','admin_users',false),
-- staff
('staff','dashboard',false),('staff','activity',false),('staff','inventory',true),('staff','deals',true),
('staff','containers',false),('staff','movements',false),('staff','transfers',false),('staff','debts',false),
('staff','employees',false),('staff','payroll',false),('staff','investors',false),('staff','reports',false),
('staff','clients',true),('staff','inquiries',true),('staff','purchase_orders',false),('staff','suppliers',false),
('staff','audit_log',false),('staff','admin_users',false),
-- accountant
('accountant','dashboard',false),('accountant','activity',false),('accountant','inventory',true),('accountant','deals',true),
('accountant','containers',true),('accountant','movements',true),('accountant','transfers',true),('accountant','debts',true),
('accountant','employees',true),('accountant','payroll',true),('accountant','investors',true),('accountant','reports',true),
('accountant','clients',false),('accountant','inquiries',false),('accountant','purchase_orders',true),('accountant','suppliers',false),
('accountant','audit_log',false),('accountant','admin_users',false),
-- investor
('investor','dashboard',false),('investor','activity',false),('investor','inventory',true),('investor','deals',true),
('investor','containers',false),('investor','movements',false),('investor','transfers',false),('investor','debts',false),
('investor','employees',false),('investor','payroll',false),('investor','investors',true),('investor','reports',false),
('investor','clients',false),('investor','inquiries',false),('investor','purchase_orders',false),('investor','suppliers',false),
('investor','audit_log',false),('investor','admin_users',false)
ON CONFLICT (role, feature_key) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ---------------------------------------------------------------------------
-- 2) activity_log: RLS (owner-like read; authenticated insert for app logging)
-- ---------------------------------------------------------------------------
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_log_select_owner_audit" ON public.activity_log;
DROP POLICY IF EXISTS "activity_log_insert_authenticated" ON public.activity_log;

CREATE POLICY "activity_log_select_owner_audit"
  ON public.activity_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(COALESCE(up.role, ''))) IN ('owner', 'admin', 'super_admin', 'manager')
    )
    OR LOWER(COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '')) IN ('owner', 'admin', 'super_admin', 'manager')
    OR LOWER(COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '')) IN ('owner', 'admin', 'super_admin', 'manager')
  );

CREATE POLICY "activity_log_insert_authenticated"
  ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id IS NULL OR actor_user_id = auth.uid()
  );

ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ---------------------------------------------------------------------------
-- 3) Deals: investors may read all rows (UI is read-only; no investor write policies added)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Investor deals select all" ON public.deals;
CREATE POLICY "Investor deals select all"
  ON public.deals FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND LOWER(TRIM(COALESCE(up.role, ''))) = 'investor'
    )
  );
