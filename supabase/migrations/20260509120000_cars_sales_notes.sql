-- Algeria sales list: shared sales notes + audit (who/when last edited)

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS sales_notes text,
  ADD COLUMN IF NOT EXISTS sales_notes_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_notes_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
