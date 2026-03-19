-- Create inquiries table for public website contact form submissions
DROP TABLE IF EXISTS inquiries CASCADE;

CREATE TABLE inquiries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  city text,
  car_id uuid REFERENCES cars(id) ON DELETE SET NULL,
  car_label text,
  message text,
  source text DEFAULT 'public_website',
  status text DEFAULT 'new',
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries(status);
CREATE INDEX IF NOT EXISTS inquiries_created_at_idx ON inquiries(created_at DESC);

ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

-- Public website can submit inquiries (anon)
CREATE POLICY "Public can submit inquiries" ON inquiries FOR INSERT TO anon WITH CHECK (true);

-- Admin panel (authenticated) can read and update
CREATE POLICY "Authenticated can read inquiries" ON inquiries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update inquiries" ON inquiries FOR UPDATE TO authenticated USING (true);
