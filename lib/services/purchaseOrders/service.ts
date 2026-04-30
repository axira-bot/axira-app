import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole } from "@/lib/auth/roles";

export type PoRole = "owner" | "manager" | "staff" | "other";
type SupportedCurrency = "USD" | "AED" | "DZD" | "EUR";

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
  const [{ data: po }, { data: items }, { data: pays }] = await Promise.all([
    admin
      .from("purchase_orders")
      .select("currency, shipping_estimate, other_fees")
      .eq("id", poId)
      .maybeSingle(),
    admin.from("purchase_order_items").select("total_cost").eq("purchase_order_id", poId),
    admin
      .from("purchase_order_payments")
      .select("amount, currency, rate_snapshot, aed_equivalent, amount_in_po_currency")
      .eq("purchase_order_id", poId),
  ]);
  const poCurrency = ((po as { currency?: string | null } | null)?.currency || "USD") as SupportedCurrency;
  const shippingEstimate = Number((po as { shipping_estimate?: number | null } | null)?.shipping_estimate || 0);
  const otherFees = Number((po as { other_fees?: number | null } | null)?.other_fees || 0);
  const itemsSubtotal = ((items as { total_cost?: number | null }[] | null) ?? []).reduce(
    (s, row) => s + Number(row.total_cost || 0),
    0
  );
  const total = itemsSubtotal + shippingEstimate + otherFees;
  const paidRows = ((pays as Array<{
    amount?: number | null;
    currency?: string | null;
    rate_snapshot?: number | null;
    aed_equivalent?: number | null;
    amount_in_po_currency?: number | null;
  }> | null) ?? []);
  const paid = paidRows.reduce((s, row) => {
    const normalized = Number(row.amount_in_po_currency ?? convertCurrencyAmount({
      amount: Number(row.amount || 0),
      fromCurrency: ((row.currency || "USD") as SupportedCurrency),
      toCurrency: poCurrency,
      rateSnapshot: row.rate_snapshot ?? null,
      aedEquivalent: row.aed_equivalent ?? null,
    }));
    return s + normalized;
  }, 0);
  const paidAed = paidRows.reduce((s, row) => {
    const aedValue = Number(row.aed_equivalent ?? convertCurrencyAmount({
      amount: Number(row.amount || 0),
      fromCurrency: ((row.currency || "USD") as SupportedCurrency),
      toCurrency: "AED",
      rateSnapshot: row.rate_snapshot ?? null,
      aedEquivalent: row.aed_equivalent ?? null,
    }));
    return s + aedValue;
  }, 0);
  const totalAed = convertCurrencyAmount({
    amount: total,
    fromCurrency: poCurrency,
    toCurrency: "AED",
    rateSnapshot: null,
    aedEquivalent: null,
  });
  const owed = total - paid;
  const owedAed = totalAed - paidAed;
  await admin
    .from("purchase_orders")
    .update({
      items_subtotal: itemsSubtotal,
      total_cost: total,
      paid_amount: paid,
      supplier_owed: owed,
      total_cost_aed: totalAed,
      paid_amount_aed: paidAed,
      supplier_owed_aed: owedAed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", poId);
  return { total, paid, owed, totalAed, paidAed, owedAed };
}

export function convertCurrencyAmount(params: {
  amount: number;
  fromCurrency: SupportedCurrency;
  toCurrency: SupportedCurrency;
  rateSnapshot?: number | null;
  aedEquivalent?: number | null;
}) {
  const amount = Number(params.amount || 0);
  if (!amount) return 0;
  if (params.fromCurrency === params.toCurrency) return amount;
  const snapshot = Number(params.rateSnapshot || 0);
  const aedEquivalent = Number(params.aedEquivalent || 0);
  const toAed = (value: number, from: SupportedCurrency) => {
    if (from === "AED") return value;
    if (snapshot > 0) {
      return from === "USD" || from === "EUR" ? value * snapshot : value / snapshot;
    }
    return from === "USD" ? value * 3.67 : value;
  };
  const fromAed = (valueAed: number, to: SupportedCurrency) => {
    if (to === "AED") return valueAed;
    if (snapshot > 0) {
      return to === "USD" || to === "EUR" ? valueAed / snapshot : valueAed * snapshot;
    }
    return to === "USD" ? valueAed / 3.67 : valueAed;
  };
  const aed = aedEquivalent > 0 ? aedEquivalent : toAed(amount, params.fromCurrency);
  return fromAed(aed, params.toCurrency);
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
