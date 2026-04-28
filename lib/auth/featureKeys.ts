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
  "admin_users",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeaturePermissions = Record<FeatureKey, boolean>;
