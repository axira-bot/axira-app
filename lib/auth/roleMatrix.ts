import { FEATURE_KEYS, type FeatureKey, type FeaturePermissions } from "@/lib/auth/featureKeys";
import { isOwnerLikeRole, normalizeRole } from "@/lib/auth/roles";

export const ROUTE_PREFIX_TO_FEATURE: Array<{ prefix: string; feature: FeatureKey }> = [
  { prefix: "/dashboard", feature: "dashboard" },
  { prefix: "/activity", feature: "activity" },
  { prefix: "/audit", feature: "audit_log" },
  { prefix: "/inventory", feature: "inventory" },
  { prefix: "/deals", feature: "deals" },
  { prefix: "/containers", feature: "containers" },
  { prefix: "/movements", feature: "movements" },
  { prefix: "/transfers", feature: "transfers" },
  { prefix: "/debts", feature: "debts" },
  { prefix: "/employees", feature: "employees" },
  { prefix: "/payroll", feature: "payroll" },
  { prefix: "/investors", feature: "investors" },
  { prefix: "/reports", feature: "reports" },
  { prefix: "/clients", feature: "clients" },
  { prefix: "/inquiries", feature: "inquiries" },
  { prefix: "/purchase-orders", feature: "purchase_orders" },
  { prefix: "/suppliers", feature: "suppliers" },
];

export function emptyFeaturePermissions(): FeaturePermissions {
  return FEATURE_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as FeaturePermissions);
}

export function roleFallbackPermissions(role: string | null | undefined): FeaturePermissions {
  const r = normalizeRole(role);
  const p = emptyFeaturePermissions();

  if (isOwnerLikeRole(r)) {
    FEATURE_KEYS.forEach((k) => {
      p[k] = true;
    });
    p.activity = false;
    p.audit_log = true;
    return p;
  }

  if (r === "manager") {
    (
      [
        "dashboard",
        "activity",
        "inventory",
        "deals",
        "containers",
        "movements",
        "transfers",
        "debts",
        "employees",
        "reports",
        "clients",
        "inquiries",
      ] as const
    ).forEach((k) => {
      p[k] = true;
    });
    return p;
  }

  if (r === "staff") {
    (["deals", "inventory", "clients", "inquiries"] as const).forEach((k) => {
      p[k] = true;
    });
    return p;
  }

  if (r === "accountant") {
    (
      [
        "containers",
        "deals",
        "inventory",
        "movements",
        "transfers",
        "debts",
        "employees",
        "payroll",
        "reports",
        "investors",
        "purchase_orders",
      ] as const
    ).forEach((k) => {
      p[k] = true;
    });
    return p;
  }

  if (r === "investor") {
    p.investors = true;
    p.deals = true;
    p.inventory = true;
    return p;
  }

  return p;
}

export function roleFallbackAllowsFeature(role: string, feature: FeatureKey): boolean {
  const p = roleFallbackPermissions(role);
  return Boolean(p[feature]);
}

export function defaultRouteForRole(role: string): string {
  const r = normalizeRole(role);
  if (isOwnerLikeRole(r)) return "/dashboard";
  if (r === "manager") return "/dashboard";
  if (r === "staff") return "/deals";
  if (r === "accountant") return "/containers";
  if (r === "investor") return "/investors";
  return "/dashboard";
}

export function canUseDestructiveActions(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  if (r === "manager" || r === "investor") return false;
  return true;
}

export function isInvestorReadOnly(role: string | null | undefined): boolean {
  return normalizeRole(role) === "investor";
}
