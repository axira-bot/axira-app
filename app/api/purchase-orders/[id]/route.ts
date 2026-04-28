import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess, recomputePoTotals } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type PoPatchBody = {
  supplier_id?: string | null;
  source_market?: "china" | "dubai" | "other";
  currency?: "USD" | "AED" | "DZD" | "EUR";
  fx_rate_to_aed?: number | null;
  expected_arrival_date?: string | null;
  ordered_at?: string | null;
  notes?: string | null;
  status?: "draft" | "ordered" | "partial_received" | "received" | "cancelled";
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePoAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await context.params;
    const admin = createAdminClient();
    const [{ data: po, error: poErr }, { data: items }, { data: payments }, { data: links }, { data: linkedCars }] = await Promise.all([
      admin.from("purchase_orders").select("*, suppliers(name)").eq("id", id).maybeSingle(),
      admin.from("purchase_order_items").select("*").eq("purchase_order_id", id).order("created_at", { ascending: true }),
      admin.from("purchase_order_payments").select("*").eq("purchase_order_id", id).order("date", { ascending: false }),
      admin.from("purchase_order_item_cars").select("purchase_order_item_id, car_id").order("created_at", { ascending: true }),
      admin.from("cars").select("id, purchase_order_item_id, vin, status, inventory_lifecycle_status").eq("purchase_order_id", id),
    ]);
    if (poErr || !po) return NextResponse.json({ error: "PO not found" }, { status: 404 });
    return NextResponse.json({
      row: po,
      items: items ?? [],
      payments: payments ?? [],
      itemCars: links ?? [],
      cars: linkedCars ?? [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await context.params;
    const body = (await request.json()) as PoPatchBody;
    const admin = createAdminClient();
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.supplier_id !== undefined) payload.supplier_id = body.supplier_id;
    if (body.source_market !== undefined) payload.source_market = body.source_market;
    if (body.currency !== undefined) payload.currency = body.currency;
    if (body.fx_rate_to_aed !== undefined) payload.fx_rate_to_aed = body.fx_rate_to_aed;
    if (body.expected_arrival_date !== undefined) payload.expected_arrival_date = body.expected_arrival_date;
    if (body.ordered_at !== undefined) payload.ordered_at = body.ordered_at;
    if (body.notes !== undefined) payload.notes = body.notes;
    if (body.status !== undefined) payload.status = body.status;

    const { data, error } = await admin
      .from("purchase_orders")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "PO not found" }, { status: 400 });
    await recomputePoTotals(id);
    return NextResponse.json({ row: data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await context.params;
    const admin = createAdminClient();
    const { data: linkedCars } = await admin
      .from("cars")
      .select("id")
      .eq("purchase_order_id", id)
      .limit(1);
    if ((linkedCars?.length ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete PO with generated inventory cars. Set status to cancelled instead." },
        { status: 400 }
      );
    }
    const { error } = await admin.from("purchase_orders").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
