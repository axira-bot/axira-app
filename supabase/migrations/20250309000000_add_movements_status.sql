-- Optional: add status to movements for Transfer approval flow (External transfers).
-- Run this in Supabase SQL Editor if your movements table doesn't have a status column.
ALTER TABLE movements ADD COLUMN IF NOT EXISTS status TEXT;
