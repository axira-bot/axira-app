-- Axira Admin App: Schema audit pack
-- Run after supabase-admin-full-setup.sql

-- 1) Required tables
WITH required_tables AS (
  SELECT unnest(ARRAY[
    'cars','deals','movements','clients','containers','container_cars',
    'employees','commissions','investors','investor_returns',
    'user_profiles','rents','activity_log','inquiries',
    'cash_positions','payments','debts','debt_payments',
    'app_settings','salaries'
  ]) AS table_name
)
SELECT
  rt.table_name,
  CASE WHEN c.oid IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM required_tables rt
LEFT JOIN pg_class c
  ON c.relname = rt.table_name
 AND c.relkind = 'r'
LEFT JOIN pg_namespace n
  ON n.oid = c.relnamespace
 AND n.nspname = 'public'
ORDER BY rt.table_name;

-- 2) Required columns
WITH required_columns AS (
  SELECT * FROM (VALUES
    ('deals','sale_usd'),
    ('deals','handled_by'),
    ('deals','handled_by_name'),
    ('cars','country_of_origin'),
    ('cars','photos'),
    ('cars','supplier_paid'),
    ('cars','supplier_owed'),
    ('employees','salary_currency'),
    ('movements','status'),
    ('user_profiles','employee_id'),
    ('user_profiles','investor_id')
  ) AS t(table_name,column_name)
)
SELECT
  rc.table_name,
  rc.column_name,
  CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM required_columns rc
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = rc.table_name
 AND c.column_name = rc.column_name
ORDER BY rc.table_name, rc.column_name;
