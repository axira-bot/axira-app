import { createClient as createServerClient } from "@/lib/supabase/server";
import { resolvePermissions, hasFeature } from "@/lib/auth/permissions";
import { resolveEffectiveRole } from "@/lib/auth/resolveUserRole";
import type { FeaturePermissions } from "@/lib/auth/featureKeys";
import { isOwnerLikeRole, normalizeRole } from "@/lib/auth/roles";

export type SalesListAuth =
  | { ok: true; userId: string; role: string; permissions: FeaturePermissions; canSeeInternal: boolean }
  | { ok: false; status: number; error: string };

/** Owner-like + manager may edit sales_notes; staff read-only (matches UI isOwnerLike || isManager). */
export function canEditSalesNotes(auth: SalesListAuth): auth is SalesListAuth & { ok: true } {
  return auth.ok && auth.canSeeInternal;
}

/** Staff + manager + owner-like may read sales list; internal fields for manager + owner-like only. */
export async function requireSalesListRead(): Promise<SalesListAuth> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  const role = resolveEffectiveRole((profile as { role?: string } | null)?.role, user);
  const metadataPermissions =
    (user.app_metadata as { feature_permissions?: Record<string, boolean> } | null)?.feature_permissions ?? null;
  const permissions = await resolvePermissions(user.id, role, metadataPermissions);
  if (!hasFeature(permissions, "sales_list")) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const r = normalizeRole(role);
  const canSeeInternal = r === "manager" || isOwnerLikeRole(r);
  return { ok: true, userId: user.id, role, permissions, canSeeInternal };
}

export async function requireSalesCatalogAdmin(): Promise<SalesListAuth> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  const role = resolveEffectiveRole((profile as { role?: string } | null)?.role, user);
  const metadataPermissions =
    (user.app_metadata as { feature_permissions?: Record<string, boolean> } | null)?.feature_permissions ?? null;
  const permissions = await resolvePermissions(user.id, role, metadataPermissions);
  if (!hasFeature(permissions, "sales_catalog_admin")) {
    return { ok: false, status: 403, error: "Owner only" };
  }
  const canSeeInternal = true;
  return { ok: true, userId: user.id, role, permissions, canSeeInternal };
}
