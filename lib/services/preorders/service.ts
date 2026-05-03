import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toAed } from "@/lib/finance/dealMoney";
import { isPreorderPrivilegedRole } from "@/lib/auth/roles";
import type { DealLifecycleStatus } from "./types";
import { LIFECYCLE_TRANSITIONS } from "./types";

type AuthContext =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; error: string };

async function resolveAuth(): Promise<AuthContext> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const profileRole = (profile as { role?: string } | null)?.role ?? null;
  const metadataRole =
    (user.user_metadata as { role?: string } | null)?.role ??
    (user.app_metadata as { role?: string } | null)?.role ??
    null;
  const role = (profileRole || metadataRole || "").toLowerCase();

  if (!isPreorderPrivilegedRole(role)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, userId: user.id, role };
}

export async function requirePreorderAccess() {
  return resolveAuth();
}

export async function ensureClient(
  admin: ReturnType<typeof createAdminClient>,
  clientInput: {
    id?: string;
    name: string;
    phone: string;
    passport_number?: string | null;
    algeria_address?: string | null;
  }
) {
  if (clientInput.id) return clientInput.id;

  const { data: existingByPhone } = await admin
    .from("clients")
    .select("id")
    .eq("phone", clientInput.phone)
    .limit(1)
    .maybeSingle();
  if (existingByPhone?.id) {
    await admin
      .from("clients")
      .update({
        name: clientInput.name,
        passport_number: clientInput.passport_number ?? null,
        algeria_address: clientInput.algeria_address ?? null,
      })
      .eq("id", existingByPhone.id);
    return existingByPhone.id as string;
  }

  const { data: inserted, error } = await admin
    .from("clients")
    .insert({
      name: clientInput.name,
      phone: clientInput.phone,
      type: "Client",
      passport_number: clientInput.passport_number ?? null,
      algeria_address: clientInput.algeria_address ?? null,
    })
    .select("id")
    .single();
  if (error || !inserted?.id) {
    throw new Error(error?.message || "Failed to create client");
  }
  return inserted.id as string;
}

export async function createPreorderDeal(payload: Record<string, unknown>) {
  const admin = createAdminClient();
  const client = payload.client as {
    id?: string;
    name: string;
    phone: string;
    passport_number?: string | null;
    algeria_address?: string | null;
  };
  const clientId = await ensureClient(admin, client);

  const source = payload.source as string;
  const catalog = payload.catalog as Record<string, unknown> | undefined;
  const customSpec = payload.custom_spec as Record<string, unknown> | undefined;

  const brand =
    (catalog?.brand as string | undefined) ||
    (customSpec?.brand as string | undefined) ||
    "Pre-order";
  const model =
    (catalog?.model as string | undefined) ||
    (customSpec?.model as string | undefined) ||
    "Custom";
  const year = (catalog?.year as number | null | undefined) ?? (customSpec?.year as number | null | undefined);
  const color = (catalog?.color as string | undefined) || (customSpec?.color as string | undefined) || null;
  const trim = (catalog?.trim as string | undefined) || (customSpec?.trim as string | undefined) || null;

  const carLabel = [brand, model, year ? String(year) : null, color].filter(Boolean).join(" ");
  const saleDzd = Number(payload.sale_dzd || 0);
  const rate = Number(payload.rate || 0);
  const saleRateToAed = rate > 0 ? 1 / rate : null;
  const sourceCost = Number(payload.source_cost || 0);
  const srcCur = String(payload.source_currency || "AED").toUpperCase();
  if (srcCur !== "AED" && (!Number(payload.source_rate_to_aed) || Number(payload.source_rate_to_aed) <= 0)) {
    throw new Error("source_rate_to_aed is required for non-AED source currency.");
  }
  const costRateToAed = srcCur === "AED" ? 1 : Number(payload.source_rate_to_aed || 0);

  const statusForCompatibility: "pending" | "closed" = "pending";
  const lifecycleStatus = "PRE_ORDER";

  const customSpecSignature =
    source === "PRE_ORDER_CUSTOM"
      ? `${brand}|${model}|${year ?? ""}|${color ?? ""}|${trim ?? ""}`.toLowerCase()
      : null;

  const dealInsert = await admin
    .from("deals")
    .insert({
      client_id: clientId,
      client_name: client.name,
      car_id: null,
      car_label: carLabel,
      date: payload.date,
      sale_amount: saleDzd,
      sale_currency: "DZD",
      sale_rate_to_aed: saleRateToAed,
      cost_amount: sourceCost,
      cost_currency: srcCur,
      cost_rate_to_aed: costRateToAed,
      collected_dzd: 0,
      pending_dzd: saleDzd,
      status: statusForCompatibility,
      notes: (payload.notes as string | null | undefined) ?? null,
      source,
      lifecycle_status: lifecycleStatus,
      agreed_delivery_date: (payload.agreed_delivery_date as string | null | undefined) ?? null,
      source_cost: sourceCost,
      source_currency: payload.source_currency,
      source_rate_to_dzd: payload.source_rate_to_dzd,
      source_rate_to_aed: payload.source_rate_to_aed,
      custom_spec_signature: customSpecSignature,
    })
    .select("id")
    .single();

  if (dealInsert.error || !dealInsert.data?.id) {
    throw new Error(dealInsert.error?.message || "Failed to create pre-order deal");
  }

  const dealId = dealInsert.data.id as string;

  if (source === "PRE_ORDER_CUSTOM" && customSpec) {
    const { error: customInsertErr } = await admin.from("deal_custom_specs").insert({
      deal_id: dealId,
      supplier_id: (customSpec.supplier_id as string | null | undefined) ?? null,
      supplier_tbd: Boolean(customSpec.supplier_tbd),
      brand: customSpec.brand,
      model: customSpec.model,
      year: customSpec.year ?? null,
      color: customSpec.color ?? null,
      trim: customSpec.trim ?? null,
      options: customSpec.options ?? null,
      estimated_cost: customSpec.estimated_cost ?? null,
      estimated_currency: customSpec.estimated_currency ?? null,
      supplier_confirmation_required: customSpec.supplier_confirmation_required ?? true,
      supplier_confirmed: false,
    });
    if (customInsertErr) throw new Error(customInsertErr.message);
  }

  if (source === "PRE_ORDER_CATALOG" && catalog) {
    const { error: catalogMetaErr } = await admin.from("deal_custom_specs").insert({
      deal_id: dealId,
      supplier_id: catalog.supplier_id ?? null,
      supplier_tbd: false,
      brand: catalog.brand,
      model: catalog.model,
      year: catalog.year ?? null,
      color: catalog.color ?? null,
      trim: catalog.trim ?? null,
      options: null,
      estimated_cost: payload.source_cost ?? null,
      estimated_currency: payload.source_currency ?? null,
      supplier_confirmation_required: false,
      supplier_confirmed: true,
    });
    if (catalogMetaErr) throw new Error(catalogMetaErr.message);
  }

  const deposit = payload.deposit as Record<string, unknown> | undefined;
  if (deposit && Number(deposit.amount_dzd || 0) > 0) {
    const amountDzd = Number(deposit.amount_dzd || 0);
    const date = (deposit.date as string | undefined) || (payload.date as string);
    const rateSnapshot = Number(payload.rate || 0);
    const rateToAed = rateSnapshot > 0 ? 1 / rateSnapshot : 1;
    const aedEquivalent = toAed(amountDzd, "DZD", rateToAed);

    const payIns = await admin
      .from("payments")
      .insert({
        deal_id: dealId,
        dzd: amountDzd,
        date,
        type: "preorder_deposit",
        rate: rateToAed,
        notes: (deposit.notes as string | null | undefined) ?? null,
        kind: "customer_deposit",
        currency: "DZD",
        amount: amountDzd,
        rate_to_aed: rateToAed,
        aed_equivalent: aedEquivalent,
        pocket: deposit.pocket,
        method: deposit.method,
      })
      .select("id")
      .single();

    if (payIns.error || !payIns.data?.id) {
      throw new Error(payIns.error?.message || "Failed to log pre-order deposit");
    }

    await admin.from("movements").insert({
      date,
      type: "In",
      category: "Client Payment",
      description: "Pre-order deposit",
      amount: amountDzd,
      currency: "DZD",
      rate: rateToAed,
      aed_equivalent: aedEquivalent,
      pocket: deposit.pocket,
      deal_id: dealId,
      payment_id: payIns.data.id,
      reference: "PREORDER-DEPOSIT",
    });

    const { data: pocketRow } = await admin
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", String(deposit.pocket))
      .eq("currency", "DZD")
      .limit(1)
      .maybeSingle();
    if (pocketRow?.id) {
      await admin
        .from("cash_positions")
        .update({ amount: (pocketRow.amount || 0) + amountDzd })
        .eq("id", pocketRow.id);
    }

    await admin
      .from("deals")
      .update({
        collected_dzd: amountDzd,
        pending_dzd: Math.max(saleDzd - amountDzd, 0),
      })
      .eq("id", dealId);
  }

  let suggestCatalog = false;
  if (customSpecSignature) {
    const { count } = await admin
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("source", "PRE_ORDER_CUSTOM")
      .eq("custom_spec_signature", customSpecSignature);
    suggestCatalog = (count || 0) >= 3;
  }

  return { dealId, suggestCatalog };
}

export async function getDealForTransition(
  admin: ReturnType<typeof createAdminClient>,
  dealId: string
) {
  const { data, error } = await admin
    .from("deals")
    .select("id, source, status, lifecycle_status, sale_amount, sale_currency, collected_dzd, car_id, inventory_car_id")
    .eq("id", dealId)
    .single();
  if (error || !data) throw new Error(error?.message || "Deal not found");
  return data as {
    id: string;
    source: string | null;
    status: string | null;
    lifecycle_status: string | null;
    sale_amount: number | null;
    sale_currency: string | null;
    collected_dzd: number | null;
    car_id: string | null;
    inventory_car_id: string | null;
  };
}

export function assertLifecycleTransition(
  fromStatus: DealLifecycleStatus,
  toStatus: DealLifecycleStatus
) {
  const allowed = LIFECYCLE_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new Error(`Invalid transition from ${fromStatus} to ${toStatus}`);
  }
}

export async function ensureCustomPreorderConfirmed(
  admin: ReturnType<typeof createAdminClient>,
  dealId: string
) {
  const { data, error } = await admin
    .from("deal_custom_specs")
    .select("supplier_confirmation_required, supplier_confirmed")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as
    | { supplier_confirmation_required?: boolean; supplier_confirmed?: boolean }
    | null;
  if (row?.supplier_confirmation_required && !row?.supplier_confirmed) {
    throw new Error("Supplier confirmation is required before ORDERED");
  }
}
