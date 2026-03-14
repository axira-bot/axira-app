-- User profiles linked to auth.users with roles
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  role text DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff', 'investor', 'accountant')),
  employee_id uuid REFERENCES employees(id),
  investor_id uuid REFERENCES investors(id),
  created_at timestamptz DEFAULT now()
);

-- Optional: RLS so users can read their own profile
-- ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can read own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
