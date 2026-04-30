-- Axira Admin App: Schema audit pack
-- Run after supabase-admin-full-setup.sql

-- 1) Required tables
WITH required_tables AS (
  SELECT unnest(ARRAY[
    'cars','deals','movements','clients','containers','container_cars',
    'employees','commissions','investors','investor_returns',
    'suppliers','supplier_catalog','deal_custom_specs',
    'deal_costs','deal_edit_requests',
    'purchase_orders','purchase_order_items','purchase_order_item_cars','purchase_order_payments',
    'role_feature_defaults','user_feature_permissions',
    'user_profiles','rents','activity_log','inquiries',
    'client_documents',
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
    ('deals','source'),
    ('deals','lifecycle_status'),
    ('deals','created_by'),
    ('deals','pending_completion'),
    ('deals','completion_notes'),
    ('deals','inventory_car_id'),
    ('deal_costs','deal_id'),
    ('deal_costs','purchase_cost'),
    ('deal_costs','shipping_cost'),
    ('deal_costs','supplier_name'),
    ('deal_edit_requests','deal_id'),
    ('deal_edit_requests','requested_by'),
    ('deal_edit_requests','request_type'),
    ('deal_edit_requests','status'),
    ('purchase_orders','supplier_id'),
    ('purchase_orders','status'),
    ('purchase_orders','total_cost'),
    ('purchase_orders','paid_amount'),
    ('purchase_orders','supplier_owed'),
    ('purchase_order_items','purchase_order_id'),
    ('purchase_order_items','quantity'),
    ('purchase_order_items','unit_cost'),
    ('purchase_order_items','total_cost'),
    ('purchase_order_payments','purchase_order_id'),
    ('purchase_order_payments','amount'),
    ('purchase_order_payments','currency'),
    ('cars','purchase_order_id'),
    ('cars','purchase_order_item_id'),
    ('cars','country_of_origin'),
    ('cars','photos'),
    ('cars','supplier_paid'),
    ('cars','supplier_owed'),
    ('cars','inventory_lifecycle_status'),
    ('cars','linked_deal_id'),
    ('employees','employee_code'),
    ('employees','salary_currency'),
    ('commissions','currency'),
    ('commissions','rate_snapshot'),
    ('role_feature_defaults','feature_key'),
    ('role_feature_defaults','allowed'),
    ('user_feature_permissions','user_id'),
    ('user_feature_permissions','feature_key'),
    ('user_feature_permissions','allowed'),
    ('inquiries','source_channel'),
    ('inquiries','whatsapp_ref'),
    ('inquiries','assigned_employee_id'),
    ('client_documents','client_name'),
    ('client_documents','car_brand'),
    ('client_documents','car_model'),
    ('client_documents','invoice_date'),
    ('client_documents','agreement_date'),
    ('client_documents','amount_usd'),
    ('movements','status'),
    ('clients','passport_number'),
    ('clients','algeria_address'),
    ('payments','kind'),
    ('payments','rate_snapshot'),
    ('activity_log','actor_user_id'),
    ('activity_log','actor_name'),
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

-- 3) Required trigger for permanent employee code generation
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'employees'
        AND t.tgname = 'trg_set_employee_code_if_missing'
        AND NOT t.tgisinternal
    )
    THEN 'OK'
    ELSE 'MISSING'
  END AS employees_employee_code_trigger_status;

-- 4) Purchase order totals triggers
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'purchase_order_items'
        AND t.tgname = 'trg_sync_purchase_order_totals_from_items'
        AND NOT t.tgisinternal
    )
    THEN 'OK'
    ELSE 'MISSING'
  END AS po_items_totals_trigger_status;

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'purchase_order_payments'
        AND t.tgname = 'trg_sync_purchase_order_totals_from_payments'
        AND NOT t.tgisinternal
    )
    THEN 'OK'
    ELSE 'MISSING'
  END AS po_payments_totals_trigger_status;
