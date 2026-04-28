import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole } from "@/lib/auth/roles";
import { FEATURE_KEYS, type FeatureKey, type FeaturePermissions } from "@/lib/auth/featureKeys";

function emptyPermissions(): FeaturePermissions {
  return FEATURE_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as FeaturePermissions);
}

function roleFallbackPermissions(role: string | null | undefined): FeaturePermissions {
  const normalized = normalizeRole(role);
  const p = emptyPermissions();
  if (normalized === "owner" || normalized === "super_admin" || normalized === "admin") {
    FEATURE_KEYS.forEach((k) => {
      p[k] = true;
    });
    return p;
  }
  if (normalized === "staff") {
    p.inventory = true;
    p.deals = true;
    p.clients = true;
    p.inquiries = true;
    p.purchase_orders = true;
    return p;
  }
  if (normalized === "accountant") {
    p.activity = true;
    p.movements = true;
    p.reports = true;
    p.payroll = true;
    return p;
  }
  if (normalized === "investor") {
    p.investors = true;
    return p;
  }
  if (normalized === "manager") {
    p.dashboard = true;
    p.activity = true;
    p.inventory = true;
    p.deals = true;
    p.containers = true;
    p.movements = true;
    p.debts = true;
    p.payroll = true;
    p.reports = true;
    p.clients = true;
    p.inquiries = true;
    p.purchase_orders = true;
    return p;
  }
  return p;
}

export async function resolvePermissions(
  userId: string,
  role: string | null | undefined,
  metadataPermissions?: Partial<Record<FeatureKey, boolean>> | null
): Promise<FeaturePermissions> {
  const normalized = normalizeRole(role);
  const fallback = roleFallbackPermissions(normalized);
  if (normalized === "owner" || normalized === "super_admin" || normalized === "admin") {
    return fallback;
  }

  const admin = createAdminClient();
  const defaultsRes = await admin
    .from("role_feature_defaults")
    .select("feature_key, allowed")
    .eq("role", normalized);
  const userRes = await admin
    .from("user_feature_permissions")
    .select("feature_key, allowed")
    .eq("user_id", userId);

  const resolved = { ...fallback };
  if (!defaultsRes.error) {
    ((defaultsRes.data as { feature_key?: string; allowed?: boolean }[] | null) ?? []).forEach((row) => {
      const key = row.feature_key as FeatureKey;
      if (FEATURE_KEYS.includes(key)) resolved[key] = Boolean(row.allowed);
    });
  }
  if (!userRes.error) {
    ((userRes.data as { feature_key?: string; allowed?: boolean }[] | null) ?? []).forEach((row) => {
      const key = row.feature_key as FeatureKey;
      if (FEATURE_KEYS.includes(key)) resolved[key] = Boolean(row.allowed);
    });
  }
  (Object.entries(metadataPermissions ?? {}) as [FeatureKey, boolean][]).forEach(([key, allowed]) => {
    if (FEATURE_KEYS.includes(key)) resolved[key] = Boolean(allowed);
  });

  return resolved;
}

export function hasFeature(
  permissions: Partial<FeaturePermissions> | null | undefined,
  feature: FeatureKey
): boolean {
  return Boolean(permissions?.[feature]);
}
