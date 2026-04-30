import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess, recomputePoTotals } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type CreateItem = {
  brand: string;
  model: string;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  quantity?: number;
  unit_cost?: number;
  notes?: string | null;
  inventory_status?: "in_transit" | "arrived" | "available" | "sold";
};

type Body = {
  items?: CreateItem[];
  create_inventory_rows?: boolean;
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
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return NextResponse.json({ error: "At least one item is required." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: po } = await admin
      .from("purchase_orders")
      .select("id, supplier_id, currency")
      .eq("id", id)
      .maybeSingle();
    if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });

    const insertedItems: unknown[] = [];
    const createdCars: unknown[] = [];
    const createInventoryRows = body.create_inventory_rows !== false;

    for (const rawItem of items) {
      if (!rawItem.brand?.trim() || !rawItem.model?.trim()) {
        return NextResponse.json({ error: "Each item needs brand and model." }, { status: 400 });
      }
      const quantity = Math.max(1, Number(rawItem.quantity || 1));
      const unitCost = Number(rawItem.unit_cost || 0);
      const { data: item, error: itemErr } = await admin
        .from("purchase_order_items")
        .insert({
          purchase_order_id: id,
          brand: rawItem.brand.trim(),
          model: rawItem.model.trim(),
          year: rawItem.year ?? null,
          color: rawItem.color?.trim() || null,
          vin: rawItem.vin?.trim() || null,
          quantity,
          unit_cost: unitCost,
          total_cost: quantity * unitCost,
          inventory_status: rawItem.inventory_status || "in_transit",
          notes: rawItem.notes?.trim() || null,
        })
        .select("*")
        .single();
      if (itemErr || !item) return NextResponse.json({ error: itemErr?.message ?? "Failed to add item" }, { status: 400 });
      insertedItems.push(item);

      if (!createInventoryRows) continue;
      for (let i = 0; i < quantity; i += 1) {
        const initialStatus = rawItem.inventory_status || "in_transit";
        const carStatus = initialStatus === "available" ? "available" : "in_transit";
        const lifecycle =
          rawItem.vin?.trim()
            ? "READY_TO_SHIP"
            : initialStatus === "available"
              ? "IN_STOCK"
              : initialStatus === "arrived"
                ? "ARRIVED"
                : "INCOMING";
        const carPayload = {
          brand: rawItem.brand.trim(),
          model: rawItem.model.trim(),
          year: rawItem.year ?? null,
          color: rawItem.color?.trim() || null,
          vin: quantity === 1 && i === 0 ? rawItem.vin?.trim() || null : null,
          purchase_price: unitCost,
          purchase_currency: (po as { currency?: string | null }).currency || "USD",
          mileage: 0,
          condition: "brand new",
          stock_type: "axira",
          location: "In Transit",
          owner: "supplier",
          status: carStatus,
          inventory_lifecycle_status: lifecycle,
          supplier_id: (po as { supplier_id?: string | null }).supplier_id || null,
          purchase_order_id: id,
          purchase_order_item_id: (item as { id: string }).id,
        };
        let carIns = await admin.from("cars").insert(carPayload).select("id").single();
        if (carIns.error && (carIns.error.message || "").includes("schema cache")) {
          const fallbackPayload: Record<string, unknown> = { ...carPayload };
          const msg = carIns.error.message || "";
          if (msg.includes("supplier_id")) delete fallbackPayload.supplier_id;
          if (msg.includes("inventory_lifecycle_status")) delete fallbackPayload.inventory_lifecycle_status;
          if (msg.includes("purchase_order_id")) delete fallbackPayload.purchase_order_id;
          if (msg.includes("purchase_order_item_id")) delete fallbackPayload.purchase_order_item_id;
          carIns = await admin.from("cars").insert(fallbackPayload).select("id").single();
        }
        const { data: car, error: carErr } = carIns;
        if (carErr || !car) return NextResponse.json({ error: carErr?.message ?? "Failed to create inventory car" }, { status: 400 });
        await admin.from("purchase_order_item_cars").insert({
          purchase_order_item_id: (item as { id: string }).id,
          car_id: (car as { id: string }).id,
        });
        createdCars.push(car);
      }
    }

    await recomputePoTotals(id);
    return NextResponse.json({ items: insertedItems, cars: createdCars }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
