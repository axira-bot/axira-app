-- Optional grade/trim on PO lines (mirrors inventory car specs; synced to cars in a later RPC).
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS grade text;
