-- Purchase order (and some API) paths insert method + note on movements; older schemas often only had description/pocket.
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS method text;

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN public.movements.method IS 'Payment rail (e.g. bank_transfer) when relevant.';

COMMENT ON COLUMN public.movements.note IS 'Free-text note; some flows use description instead — both may exist.';
