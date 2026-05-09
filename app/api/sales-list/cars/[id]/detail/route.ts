import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesListRead } from "@/lib/services/salesList/access";

export const dynamic = "force-dynamic";

function stripCarForStaff<T extends Record<string, unknown>>(row: T): T {
  const { sales_internal_note: _i, sales_cost_estimate_dzd: _c, ...rest } = row;
  return rest as T;
}

async function resolveUserDisplayName(admin: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data: profile } = await admin.from("user_profiles").select("name").eq("id", userId).maybeSingle();
  const name = (profile as { name?: string | null } | null)?.name?.trim();
  if (name) return name;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return data.user.email ?? null;
}

const CAR_DETAIL_SELECT = [
  "id",
  "brand",
  "model",
  "year",
  "color",
  "vin",
  "photos",
  "mileage",
  "grade",
  "sale_price_dzd",
  "sales_lead_time_days",
  "sales_deposit_dzd",
  "sales_internal_note",
  "sales_cost_estimate_dzd",
  "sales_notes",
  "sales_notes_updated_at",
  "sales_notes_updated_by",
  "inventory_lifecycle_status",
  "lifecycle_status",
  "status",
  "status_override",
  "display_status",
  "stock_type",
  "supplier_name",
  "purchase_order_id",
  "linked_deal_id",
  "location",
  "notes",
  "body_type",
  "drive_type",
  "doors",
  "seats",
  "transmission",
  "fuel_type",
  "engine",
  "condition",
  "features",
  "country_of_origin",
  "interior_color",
  "body_issues",
  "created_at",
].join(", ");

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSalesListRead();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: carId } = await context.params;
  const admin = createAdminClient();

  const { data: carRaw, error: carErr } = await admin.from("cars").select(CAR_DETAIL_SELECT).eq("id", carId).maybeSingle();
  if (carErr) return NextResponse.json({ error: carErr.message }, { status: 400 });
  if (!carRaw) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let car = carRaw as unknown as Record<string, unknown>;
  if (!auth.canSeeInternal) car = stripCarForStaff(car);

  const sales_notes_updated_by_name = await resolveUserDisplayName(
    admin,
    (car.sales_notes_updated_by as string | null) ?? null
  );

  const poId = car.purchase_order_id as string | null;
  let purchase_order: Record<string, unknown> | null = null;
  if (poId) {
    const { data: po } = await admin
      .from("purchase_orders")
      .select("id, po_number, status, expected_arrival_date, ordered_at")
      .eq("id", poId)
      .maybeSingle();
    purchase_order = (po as Record<string, unknown>) ?? null;
  }

  let container: Record<string, unknown> | null = null;
  const { data: ccRows } = await admin
    .from("container_cars")
    .select("container_id, containers(id, ref, status, date, shipping_paid, invoice_ref)")
    .eq("car_id", carId)
    .limit(1);
  const cc = ccRows?.[0] as { containers?: Record<string, unknown> } | undefined;
  if (cc?.containers) container = cc.containers;

  const { data: dealRows } = await admin
    .from("deals")
    .select("id, client_name, status, date, sale_amount, sale_currency")
    .eq("car_id", carId)
    .order("date", { ascending: false });

  let status_timeline: Array<{ field_name: string; old_value: string | null; new_value: string; changed_at: string }> = [];
  if (auth.canSeeInternal) {
    const { data: logRows } = await admin
      .from("car_audit_log")
      .select("field_name, old_value, new_value, changed_at")
      .eq("car_id", carId)
      .in("field_name", ["lifecycle_status", "inventory_lifecycle_status"])
      .order("changed_at", { ascending: false })
      .limit(25);
    status_timeline = (logRows ?? []) as typeof status_timeline;
  }

  return NextResponse.json({
    car,
    purchase_order,
    container,
    linked_deals: dealRows ?? [],
    status_timeline,
    sales_notes_updated_by_name,
  });
}
