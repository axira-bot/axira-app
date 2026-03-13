-- Add supplier payment tracking to cars table
ALTER TABLE cars ADD COLUMN IF NOT EXISTS supplier_paid NUMERIC DEFAULT 0;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS supplier_owed NUMERIC DEFAULT 0;
