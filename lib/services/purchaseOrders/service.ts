import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole } from "@/lib/auth/roles";

export type PoRole = "owner" | "manager" | "staff" | "other";

export async function requirePoAccess(options?: { write?: boolean; ownerOnly?: boolean }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const roleRaw =
    (profile as { role?: string } | null)?.role ??
    (user.app_metadata as { role?: string } | null)?.role ??
    "staff";
  const role = normalizeRole(roleRaw);
  const poRole: PoRole =
    role === "owner" || role === "admin" || role === "super_admin"
      ? "owner"
      : role === "manager"
        ? "manager"
        : role === "staff"
          ? "staff"
          : "other";

  const canRead = poRole === "owner" || poRole === "manager" || poRole === "staff";
  const canWrite = poRole === "owner" || poRole === "manager";
  const isOwner = poRole === "owner";
  if (!canRead) return { ok: false as const, status: 403, error: "Forbidden" };
  if (options?.write && !canWrite) return { ok: false as const, status: 403, error: "Forbidden" };
  if (options?.ownerOnly && !isOwner) return { ok: false as const, status: 403, error: "Owner only action" };
  return { ok: true as const, user, role: poRole };
}

export async function recomputePoTotals(poId: string) {
  const admin = createAdminClient();
  const [{ data: items }, { data: pays }] = await Promise.all([
    admin.from("purchase_order_items").select("total_cost").eq("purchase_order_id", poId),
    admin.from("purchase_order_payments").select("amount").eq("purchase_order_id", poId),
  ]);
  const total = ((items as { total_cost?: number | null }[] | null) ?? []).reduce(
    (s, row) => s + Number(row.total_cost || 0),
    0
  );
  const paid = ((pays as { amount?: number | null }[] | null) ?? []).reduce(
    (s, row) => s + Number(row.amount || 0),
    0
  );
  const owed = total - paid;
  await admin
    .from("purchase_orders")
    .update({
      total_cost: total,
      paid_amount: paid,
      supplier_owed: owed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", poId);
  return { total, paid, owed };
}

export async function poDealEligibilityMode() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "po_deal_eligibility")
    .maybeSingle();
  const mode = (data as { value?: string | null } | null)?.value || "in_transit_or_arrived";
  if (mode === "arrived_only" || mode === "in_transit_or_arrived") return mode;
  return "in_transit_or_arrived";
}
