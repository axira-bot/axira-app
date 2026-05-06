export const FEATURE_KEYS = [
  "dashboard",
  "activity",
  "inventory",
  "deals",
  "containers",
  "movements",
  "transfers",
  "debts",
  "employees",
  "payroll",
  "investors",
  "reports",
  "clients",
  "inquiries",
  "purchase_orders",
  "suppliers",
  "audit_log",
  "admin_users",
  "sales_list",
  "sales_catalog_admin",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeaturePermissions = Record<FeatureKey, boolean>;
