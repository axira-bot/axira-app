-- Normalize legacy Algeria showroom label; enforce allowed location values on cars.

UPDATE public.cars
SET location = 'Axira DZ Showroom'
WHERE location = 'Algeria Showroom';

ALTER TABLE public.cars DROP CONSTRAINT IF EXISTS cars_location_check;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_location_check
  CHECK (
    location IS NULL
    OR location IN ('China Port', 'Dubai Showroom', 'Axira DZ Showroom', 'In Transit')
  );
