import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toAed } from "@/lib/finance/dealMoney";
import { paymentSchema } from "@/lib/services/preorders/schemas";
import { getDealForTransition, requirePreorderAccess } from "@/lib/services/preorders/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePreorderAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await context.params;
    const parsed = paymentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const admin = createAdminClient();
    const deal = await getDealForTransition(admin, id);
    const body = parsed.data;

    const date = body.date || new Date().toISOString().slice(0, 10);
    const movementType =
      body.kind === "refund" || body.kind === "supplier_payment" ? "Out" : "In";
    const aedEquivalent = toAed(body.amount, body.currency, body.rate_to_aed);

    const payIns = await admin
      .from("payments")
      .insert({
        deal_id: id,
        date,
        type: body.kind,
        notes: body.notes ?? null,
        kind: body.kind,
        currency: body.currency,
        amount: body.amount,
        rate_to_aed: body.rate_to_aed,
        aed_equivalent: aedEquivalent,
        pocket: body.pocket,
        method: body.method,
        dzd: body.currency === "DZD" ? body.amount : null,
        rate: body.rate_to_aed,
      })
      .select("id")
      .single();
    if (payIns.error || !payIns.data?.id) {
      return NextResponse.json(
        { error: payIns.error?.message || "Failed to insert payment" },
        { status: 400 }
      );
    }

    await admin.from("movements").insert({
      date,
      type: movementType,
      category: body.kind === "supplier_payment" ? "Car Purchase" : "Client Payment",
      description: `Pre-order payment (${body.kind})`,
      amount: body.amount,
      currency: body.currency,
      rate: body.rate_to_aed,
      aed_equivalent: aedEquivalent,
      pocket: body.pocket,
      payment_id: payIns.data.id,
      deal_id: id,
      reference: "PREORDER-PAYMENT",
    });

    if (body.currency === "DZD" && (body.kind === "customer_deposit" || body.kind === "customer_settlement")) {
      const prevCollected = Number(deal.collected_dzd || 0);
      const saleDzd =
        String(deal.sale_currency || "").toUpperCase() === "DZD" ? Number(deal.sale_amount || 0) : 0;
      const collected = prevCollected + body.amount;
      const pending = Math.max(saleDzd - collected, 0);
      await admin
        .from("deals")
        .update({
          collected_dzd: collected,
          pending_dzd: pending,
          lifecycle_status: pending <= 0 && deal.lifecycle_status === "ARRIVED" ? "CLOSED" : deal.lifecycle_status,
          status: pending <= 0 && deal.lifecycle_status === "ARRIVED" ? "closed" : deal.status,
        })
        .eq("id", id);
    }

    return NextResponse.json({ ok: true, paymentId: payIns.data.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
