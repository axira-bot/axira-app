import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess, recomputePoTotals } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type Body = {
  date?: string;
  amount?: number;
  currency?: "USD" | "AED" | "DZD" | "EUR";
  rate_snapshot?: number | null;
  pocket?: string | null;
  method?: string | null;
  notes?: string | null;
};

function toAed(amount: number, currency: string, rate: number | null | undefined) {
  if (currency === "AED") return amount;
  if (rate && rate > 0) return amount * rate;
  return amount;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePoAccess({ write: true, ownerOnly: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Body;
    const amount = Number(body.amount || 0);
    if (amount <= 0) return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
    const currency = body.currency || "USD";
    const rate = body.rate_snapshot ?? null;
    const aedEquivalent = toAed(amount, currency, rate);
    const admin = createAdminClient();

    const payIns = await admin
      .from("payments")
      .insert({
        kind: "supplier_payment",
        amount,
        currency,
        rate_snapshot: rate,
        aed_equivalent: aedEquivalent,
        pocket: body.pocket || "bank",
        method: body.method || "bank_transfer",
        notes: body.notes || `PO payment ${id}`,
        supplier_id: null,
        status: "paid",
      })
      .select("id")
      .single();
    if (payIns.error || !payIns.data?.id) {
      return NextResponse.json({ error: payIns.error?.message ?? "Failed to insert payment" }, { status: 400 });
    }

    const movIns = await admin
      .from("movements")
      .insert({
        date: body.date || new Date().toISOString().slice(0, 10),
        type: "expense",
        category: "supplier_payment",
        amount: aedEquivalent,
        currency: "AED",
        pocket: body.pocket || "bank",
        method: body.method || "bank_transfer",
        reference: `po:${id}:payment:${payIns.data.id}`,
        note: body.notes || `Purchase order payment`,
        status: "posted",
      })
      .select("id")
      .single();
    if (movIns.error || !movIns.data?.id) {
      return NextResponse.json({ error: movIns.error?.message ?? "Failed to insert movement" }, { status: 400 });
    }

    const poPayment = await admin
      .from("purchase_order_payments")
      .insert({
        purchase_order_id: id,
        date: body.date || new Date().toISOString().slice(0, 10),
        amount,
        currency,
        rate_snapshot: rate,
        aed_equivalent: aedEquivalent,
        pocket: body.pocket || "bank",
        method: body.method || "bank_transfer",
        notes: body.notes || null,
        movement_id: movIns.data.id,
        payment_id: payIns.data.id,
        created_by: auth.user.id,
      })
      .select("*")
      .single();
    if (poPayment.error || !poPayment.data) {
      return NextResponse.json({ error: poPayment.error?.message ?? "Failed to insert PO payment" }, { status: 400 });
    }

    const totals = await recomputePoTotals(id);
    return NextResponse.json({ row: poPayment.data, totals }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
