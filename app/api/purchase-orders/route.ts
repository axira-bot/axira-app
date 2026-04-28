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
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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
    const insertPayload = {
      po_number: newPoNumber(),
      supplier_id: body.supplier_id || null,
      source_market: body.source_market || "other",
      currency: body.currency || "USD",
      fx_rate_to_aed: body.fx_rate_to_aed ?? null,
      status: body.status || "draft",
      expected_arrival_date: body.expected_arrival_date || null,
      ordered_at: body.ordered_at || new Date().toISOString().slice(0, 10),
      notes: body.notes || null,
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
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await recomputePoTotals((data as { id: string }).id);
    return NextResponse.json({ row: data }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
