-- Generated contracts/receipts audit table + immutable storage bucket

CREATE TABLE IF NOT EXISTS public.generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  payment_id uuid NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  document_type text NOT NULL CHECK (document_type IN ('agreement', 'receipt')),
  file_url text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_generated_documents_deal_generated_at
  ON public.generated_documents(deal_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_documents_type
  ON public.generated_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_generated_documents_generated_by
  ON public.generated_documents(generated_by);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_generated_receipt_per_payment
  ON public.generated_documents (deal_id, payment_id)
  WHERE document_type = 'receipt' AND payment_id IS NOT NULL;

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generated_documents_select_owner_manager" ON public.generated_documents;
CREATE POLICY "generated_documents_select_owner_manager"
  ON public.generated_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role, '')) IN ('owner','manager','admin','super_admin')
    )
  );

DROP POLICY IF EXISTS "generated_documents_insert_owner_manager" ON public.generated_documents;
CREATE POLICY "generated_documents_insert_owner_manager"
  ON public.generated_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    generated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role, '')) IN ('owner','manager','admin','super_admin')
    )
  );

-- contracts bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('contracts', 'contracts', false)
ON CONFLICT (id) DO NOTHING;

-- immutable uploads: allow insert only, deny update/delete.
DROP POLICY IF EXISTS "contracts_insert_owner_manager" ON storage.objects;
CREATE POLICY "contracts_insert_owner_manager"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contracts'
    AND owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role, '')) IN ('owner','manager','admin','super_admin')
    )
  );

DROP POLICY IF EXISTS "contracts_select_owner_manager" ON storage.objects;
CREATE POLICY "contracts_select_owner_manager"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contracts'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND lower(coalesce(up.role, '')) IN ('owner','manager','admin','super_admin')
    )
  );
