import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess, recomputePoTotals } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type Body = {
  brand?: string;
  model?: string;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  quantity?: number;
  unit_cost?: number;
  inventory_status?: "in_transit" | "arrived" | "available" | "sold";
  notes?: string | null;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await requirePoAccess({ write: true, ownerOnly: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id, itemId } = await context.params;
    const body = (await request.json()) as Body;
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("purchase_order_items")
      .select("id, purchase_order_id, quantity, unit_cost")
      .eq("id", itemId)
      .eq("purchase_order_id", id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "PO item not found" }, { status: 404 });
    const quantity = body.quantity ?? Number((existing as { quantity?: number }).quantity || 1);
    const unitCost = body.unit_cost ?? Number((existing as { unit_cost?: number }).unit_cost || 0);
    const payload: Record<string, unknown> = {
      total_cost: quantity * unitCost,
      updated_at: new Date().toISOString(),
    };
    if (body.brand !== undefined) payload.brand = body.brand.trim();
    if (body.model !== undefined) payload.model = body.model.trim();
    if (body.year !== undefined) payload.year = body.year;
    if (body.color !== undefined) payload.color = body.color;
    if (body.vin !== undefined) payload.vin = body.vin;
    if (body.quantity !== undefined) payload.quantity = Math.max(1, Number(body.quantity || 1));
    if (body.unit_cost !== undefined) payload.unit_cost = Number(body.unit_cost || 0);
    if (body.inventory_status !== undefined) payload.inventory_status = body.inventory_status;
    if (body.notes !== undefined) payload.notes = body.notes;

    const { data, error } = await admin
      .from("purchase_order_items")
      .update(payload)
      .eq("id", itemId)
      .eq("purchase_order_id", id)
      .select("*")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
    await recomputePoTotals(id);
    return NextResponse.json({ row: data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
