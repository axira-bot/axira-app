import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess, recomputePoTotals } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type PoCreateBody = {
  supplier_id?: string | null;
  source_market?: "china" | "dubai" | "other";
  currency?: "USD" | "AED" | "DZD" | "EUR";
  fx_rate_to_aed?: number | null;
  expected_arrival_date?: string | null;
  ordered_at?: string | null;
  notes?: string | null;
  status?: "draft" | "ordered" | "partial_received" | "received" | "cancelled";
  shipping_estimate?: number;
  other_fees?: number;
  create_inventory_rows?: boolean;
  items?: Array<{
    brand?: string;
    model?: string;
    year?: number | null;
    color?: string | null;
    vin?: string | null;
    quantity?: number;
    unit_cost?: number;
    notes?: string | null;
    inventory_status?: "in_transit" | "arrived" | "available" | "sold";
  }>;
};

function newPoNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `PO-${y}${m}${day}-${suffix}`;
}

export async function GET(request: NextRequest) {
  const auth = await requirePoAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const admin = createAdminClient();
    const supplierId = (request.nextUrl.searchParams.get("supplier_id") || "").trim();
    const status = (request.nextUrl.searchParams.get("status") || "").trim();
    let q = admin.from("purchase_orders").select("*").order("created_at", { ascending: false });
    if (supplierId) q = q.eq("supplier_id", supplierId);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      const msg = error.message || "Query failed";
      if (msg.includes("purchase_orders") && msg.includes("schema cache")) {
        return NextResponse.json(
          {
            error:
              "Purchase Orders database schema is missing. Run supabase-purchase-orders-bootstrap.sql in Supabase SQL Editor, then refresh.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ rows: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as PoCreateBody;
    const admin = createAdminClient();
    const shippingEstimate = Number(body.shipping_estimate || 0);
    const otherFees = Number(body.other_fees || 0);
    const includeInventoryRows = body.create_inventory_rows !== false;
    const createItems = Array.isArray(body.items) ? body.items : [];
    const notesWithSummary = [
      body.notes || null,
      JSON.stringify({
        po_summary_v1: {
          shipping_estimate: shippingEstimate,
          other_fees: otherFees,
        },
      }),
    ]
      .filter(Boolean)
      .join("\n");

    const insertPayload = {
      po_number: newPoNumber(),
      supplier_id: body.supplier_id || null,
      source_market: body.source_market || "other",
      currency: body.currency || "USD",
      fx_rate_to_aed: body.fx_rate_to_aed ?? null,
      status: body.status || "draft",
      expected_arrival_date: body.expected_arrival_date || null,
      ordered_at: body.ordered_at || new Date().toISOString().slice(0, 10),
      notes: notesWithSummary || null,
      total_cost: 0,
      paid_amount: 0,
      supplier_owed: 0,
      created_by: auth.user.id,
    };
    const { data, error } = await admin
      .from("purchase_orders")
      .insert(insertPayload)
      .select("*")
      .single();
    if (error) {
      const msg = error.message || "Insert failed";
      if (msg.includes("purchase_orders") && msg.includes("schema cache")) {
        return NextResponse.json(
          {
            error:
              "Purchase Orders database schema is missing. Run supabase-purchase-orders-bootstrap.sql in Supabase SQL Editor, then refresh.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const poId = (data as { id: string }).id;
    if (createItems.length > 0) {
      const adminPo = await admin
        .from("purchase_orders")
        .select("id, supplier_id")
        .eq("id", poId)
        .maybeSingle();
      const po = adminPo.data as { id: string; supplier_id?: string | null } | null;
      if (!po) {
        return NextResponse.json({ error: "PO created but could not be reloaded." }, { status: 500 });
      }

      for (const rawItem of createItems) {
        if (!rawItem.brand?.trim() || !rawItem.model?.trim()) {
          return NextResponse.json({ error: "Each item needs brand and model." }, { status: 400 });
        }
        const quantity = Math.max(1, Number(rawItem.quantity || 1));
        const unitCost = Number(rawItem.unit_cost || 0);
        const rowTotal = quantity * unitCost;
        const itemIns = await admin
          .from("purchase_order_items")
          .insert({
            purchase_order_id: poId,
            brand: rawItem.brand.trim(),
            model: rawItem.model.trim(),
            year: rawItem.year ?? null,
            color: rawItem.color?.trim() || null,
            vin: rawItem.vin?.trim() || null,
            quantity,
            unit_cost: unitCost,
            total_cost: rowTotal,
            inventory_status: rawItem.inventory_status || "in_transit",
            notes: rawItem.notes?.trim() || null,
          })
          .select("*")
          .single();
        if (itemIns.error || !itemIns.data) {
          return NextResponse.json({ error: itemIns.error?.message ?? "Failed to create item rows." }, { status: 400 });
        }
        if (!includeInventoryRows) continue;
        for (let i = 0; i < quantity; i += 1) {
          const initialStatus = rawItem.inventory_status || "in_transit";
          const carStatus = initialStatus === "available" ? "available" : "in_transit";
          const lifecycle =
            initialStatus === "available" ? "IN_STOCK" : initialStatus === "arrived" ? "ARRIVED" : "INCOMING";
          const carPayload = {
            brand: rawItem.brand.trim(),
            model: rawItem.model.trim(),
            year: rawItem.year ?? null,
            color: rawItem.color?.trim() || null,
            vin: quantity === 1 && i === 0 ? rawItem.vin?.trim() || null : null,
            purchase_price: unitCost,
            purchase_currency: body.currency || "USD",
            location: "In Transit",
            owner: "supplier",
            status: carStatus,
            inventory_lifecycle_status: lifecycle,
            supplier_id: po.supplier_id || null,
            purchase_order_id: poId,
            purchase_order_item_id: (itemIns.data as { id: string }).id,
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
          if (carIns.error || !carIns.data) {
            return NextResponse.json({ error: carIns.error?.message ?? "Failed to create inventory placeholders." }, { status: 400 });
          }
          await admin.from("purchase_order_item_cars").insert({
            purchase_order_item_id: (itemIns.data as { id: string }).id,
            car_id: (carIns.data as { id: string }).id,
          });
        }
      }
    }

    const totals = await recomputePoTotals(poId);
    const grandTotal = Number(totals.total || 0) + shippingEstimate + otherFees;
    await admin
      .from("purchase_orders")
      .update({
        total_cost: grandTotal,
        supplier_owed: grandTotal - Number(totals.paid || 0),
        updated_at: new Date().toISOString(),
      })
      .eq("id", poId);
    const { data: finalRow } = await admin.from("purchase_orders").select("*").eq("id", poId).maybeSingle();
    return NextResponse.json({ row: finalRow ?? data }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
