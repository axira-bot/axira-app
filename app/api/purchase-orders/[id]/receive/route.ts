import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type Body = {
  mode?: "arrived" | "available";
  item_ids?: string[];
  vin_assignments?: Array<{ car_id: string; vin: string }>;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePoAccess({ write: true, ownerOnly: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Body;
    const admin = createAdminClient();
    const targetStatus = body.mode === "available" ? "available" : "arrived";
    const lifecycle = targetStatus === "available" ? "IN_STOCK" : "ARRIVED";
    const itemIds = Array.isArray(body.item_ids) ? body.item_ids : [];

    const itemsQuery = admin
      .from("purchase_order_items")
      .select("id")
      .eq("purchase_order_id", id);
    const itemsRes = itemIds.length ? await itemsQuery.in("id", itemIds) : await itemsQuery;
    if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 400 });
    const ids = ((itemsRes.data as { id: string }[] | null) ?? []).map((r) => r.id);
    if (!ids.length) return NextResponse.json({ error: "No matching items found." }, { status: 404 });

    const { error: itemErr } = await admin
      .from("purchase_order_items")
      .update({ inventory_status: targetStatus, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 400 });

    const { data: itemCars, error: linkErr } = await admin
      .from("purchase_order_item_cars")
      .select("car_id, purchase_order_item_id")
      .in("purchase_order_item_id", ids);
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });
    const carIds = ((itemCars as { car_id: string }[] | null) ?? []).map((row) => row.car_id);
    if (carIds.length) {
      const { error: carErr } = await admin
        .from("cars")
        .update({
          status: targetStatus === "available" ? "available" : "in_transit",
          inventory_lifecycle_status: lifecycle,
        })
        .in("id", carIds);
      if (carErr) return NextResponse.json({ error: carErr.message }, { status: 400 });
    }

    const vinAssignments = Array.isArray(body.vin_assignments) ? body.vin_assignments : [];
    for (const assignment of vinAssignments) {
      if (!assignment?.car_id || !assignment?.vin?.trim()) continue;
      const { error: vinErr } = await admin
        .from("cars")
        .update({ vin: assignment.vin.trim() })
        .eq("id", assignment.car_id)
        .in("id", carIds);
      if (vinErr) return NextResponse.json({ error: vinErr.message }, { status: 400 });
    }

    const [{ data: remainingTransit }, { error: poErr }] = await Promise.all([
      admin
        .from("purchase_order_items")
        .select("id")
        .eq("purchase_order_id", id)
        .in("inventory_status", ["in_transit", "incoming"]),
      admin
        .from("purchase_orders")
        .update({
          status: targetStatus === "available" ? "received" : "partial_received",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id),
    ]);
    if (poErr) return NextResponse.json({ error: poErr.message }, { status: 400 });

    if (((remainingTransit as { id: string }[] | null) ?? []).length === 0) {
      await admin
        .from("purchase_orders")
        .update({ status: "received", updated_at: new Date().toISOString() })
        .eq("id", id);
    }

    return NextResponse.json({ ok: true, item_ids: ids, car_count: carIds.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
