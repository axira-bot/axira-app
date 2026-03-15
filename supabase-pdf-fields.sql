-- Migration: Add sale_usd to deals, country_of_origin to cars
-- Run this in your Supabase SQL editor

ALTER TABLE deals ADD COLUMN IF NOT EXISTS sale_usd numeric;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS country_of_origin text;
