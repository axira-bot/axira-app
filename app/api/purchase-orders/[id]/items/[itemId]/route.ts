import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess, recomputePoTotals } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

const patchBodySchema = z
  .object({
    brand: z.string().optional(),
    model: z.string().optional(),
    year: z.number().int().nullable().optional(),
    color: z.string().nullable().optional(),
    grade: z.string().nullable().optional(),
    quantity: z.number().positive().optional(),
    unit_cost: z.number().optional(),
    inventory_status: z.enum(["in_transit", "arrived", "available", "sold"]).optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

const mirrorFieldKeys = ["brand", "model", "color", "year", "grade"] as const satisfies ReadonlyArray<keyof z.infer<typeof patchBodySchema>>;

function bodyRequestsMirrorPatch(body: z.infer<typeof patchBodySchema>): boolean {
  return mirrorFieldKeys.some((k) => body[k] !== undefined);
}

/** Keys passed through to RPC (same as item row surface for this endpoint; VIN excluded). */
function buildRpcPayload(body: z.infer<typeof patchBodySchema>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (body.brand !== undefined) o.brand = body.brand.trim();
  if (body.model !== undefined) o.model = body.model.trim();
  if (body.year !== undefined) o.year = body.year;
  if (body.color !== undefined) o.color = body.color;
  if (body.grade !== undefined) o.grade = body.grade?.trim() || null;
  if (body.quantity !== undefined) o.quantity = Math.max(1, Math.floor(Number(body.quantity)));
  if (body.unit_cost !== undefined) o.unit_cost = Number(body.unit_cost);
  if (body.inventory_status !== undefined) o.inventory_status = body.inventory_status;
  if (body.notes !== undefined) o.notes = body.notes;
  return o;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id, itemId } = await context.params;
    const parsed = patchBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") || "Invalid body" }, { status: 400 });
    }
    const body = parsed.data;
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("purchase_order_items")
      .select("id, purchase_order_id, quantity, unit_cost")
      .eq("id", itemId)
      .eq("purchase_order_id", id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "PO item not found" }, { status: 404 });

    if (body.brand !== undefined && !body.brand.trim()) {
      return NextResponse.json({ error: "Brand is required" }, { status: 400 });
    }
    if (body.model !== undefined && !body.model.trim()) {
      return NextResponse.json({ error: "Model is required" }, { status: 400 });
    }

    let data: Record<string, unknown> | null = null;

    if (bodyRequestsMirrorPatch(body)) {
      const rpcPayload = buildRpcPayload(body);
      if (Object.keys(rpcPayload).length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
      }
      const { data: rpcRow, error: rpcErr } = await admin.rpc("purchase_order_item_update_sync_linked_cars", {
        p_po_id: id,
        p_item_id: itemId,
        p_fields: rpcPayload,
        p_user_id: auth.user.id,
      });
      if (rpcErr) {
        const msg = rpcErr.message || "";
        if (msg.includes("PO_ITEM_NOT_FOUND") || msg.includes("PO_ITEM_PO_MISMATCH")) {
          return NextResponse.json({ error: "PO item not found" }, { status: 404 });
        }
        if (msg.includes("BRAND_REQUIRED")) return NextResponse.json({ error: "Brand is required" }, { status: 400 });
        if (msg.includes("MODEL_REQUIRED")) return NextResponse.json({ error: "Model is required" }, { status: 400 });
        if (msg.includes("INVALID_INVENTORY_STATUS")) {
          return NextResponse.json({ error: "Invalid inventory_status" }, { status: 400 });
        }
        return NextResponse.json({ error: msg || "Update failed" }, { status: 400 });
      }
      const row = (Array.isArray(rpcRow) ? rpcRow[0] : rpcRow) as Record<string, unknown> | null | undefined;
      if (!row) return NextResponse.json({ error: "Update failed" }, { status: 400 });
      data = row;
    } else {
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
      if (body.grade !== undefined) payload.grade = body.grade?.trim() || null;
      if (body.quantity !== undefined) payload.quantity = Math.max(1, Number(body.quantity || 1));
      if (body.unit_cost !== undefined) payload.unit_cost = Number(body.unit_cost || 0);
      if (body.inventory_status !== undefined) payload.inventory_status = body.inventory_status;
      if (body.notes !== undefined) payload.notes = body.notes;

      const { data: upd, error } = await admin
        .from("purchase_order_items")
        .update(payload)
        .eq("id", itemId)
        .eq("purchase_order_id", id)
        .select("*")
        .maybeSingle();
      if (error || !upd) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
      data = upd as Record<string, unknown>;
    }

    await recomputePoTotals(id);
    return NextResponse.json({ row: data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
