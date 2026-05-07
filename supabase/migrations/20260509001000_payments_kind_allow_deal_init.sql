-- App inserts use kind deal_init / client_payment / preorder_deposit; legacy check omitted them.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;

ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check CHECK (
  kind IS NULL OR kind IN (
    'customer_deposit',
    'customer_settlement',
    'supplier_payment',
    'refund',
    'forfeit',
    'deal_init',
    'client_payment',
    'preorder_deposit'
  )
);
