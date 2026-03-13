-- Rent & fixed expenses tracking
CREATE TABLE IF NOT EXISTS rents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL,
  annual_amount numeric NOT NULL,
  monthly_amount numeric GENERATED ALWAYS AS (annual_amount / 12) STORED,
  daily_amount numeric GENERATED ALWAYS AS (annual_amount / 365) STORED,
  currency text DEFAULT 'AED',
  start_date date NOT NULL,
  end_date date,
  pocket text,
  payment_frequency text DEFAULT 'monthly',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);
