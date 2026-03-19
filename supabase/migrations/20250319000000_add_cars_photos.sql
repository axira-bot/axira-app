-- Add photos array column to cars table
ALTER TABLE cars ADD COLUMN IF NOT EXISTS photos text[];

-- Create public storage bucket for car photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'car-photos',
  'car-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read photos (public site needs this)
CREATE POLICY IF NOT EXISTS "Public read - car photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'car-photos');

-- Allow authenticated users to upload photos
CREATE POLICY IF NOT EXISTS "Authenticated upload - car photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'car-photos');

-- Allow authenticated users to delete photos
CREATE POLICY IF NOT EXISTS "Authenticated delete - car photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'car-photos');
