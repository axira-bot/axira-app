import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { supplierPaymentSchema } from "@/lib/services/preorders/schemas";
import {
  ensureCustomPreorderConfirmed,
  getDealForTransition,
  requirePreorderAccess,
} from "@/lib/services/preorders/service";
import { toAed } from "@/lib/finance/dealMoney";

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
    const parsed = supplierPaymentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const admin = createAdminClient();
    const deal = await getDealForTransition(admin, id);

    if (deal.source === "PRE_ORDER_CUSTOM") {
      await ensureCustomPreorderConfirmed(admin, id);
    }

    const existingCarId = deal.inventory_car_id || deal.car_id || null;
    let carId = existingCarId;
    if (!carId) {
      const carInsert = await admin
        .from("cars")
        .insert({
          brand: body.brand,
          model: body.model,
          year: body.year ?? null,
          color: body.color ?? null,
          notes: body.trim ?? null,
          purchase_price: body.amount,
          purchase_currency: body.currency,
          purchase_rate: body.rate_to_aed,
          location: "In Transit",
          owner: "Axira",
          status: "in_transit",
          display_status: "in_transit",
          inventory_lifecycle_status: "INCOMING",
          linked_deal_id: id,
          supplier_id: body.supplier_id,
        })
        .select("id")
        .single();

      if (carInsert.error || !carInsert.data?.id) {
        return NextResponse.json(
          { error: carInsert.error?.message || "Failed to create incoming inventory entry" },
          { status: 400 }
        );
      }
      carId = carInsert.data.id as string;
    }

    const paymentDate = body.date || new Date().toISOString().slice(0, 10);
    const aedEquivalent = toAed(body.amount, body.currency, body.rate_to_aed);

    const payIns = await admin
      .from("payments")
      .insert({
        deal_id: id,
        date: paymentDate,
        type: "supplier_payment",
        notes: body.reference ?? null,
        kind: "supplier_payment",
        currency: body.currency,
        amount: body.amount,
        rate_to_aed: body.rate_to_aed,
        aed_equivalent: aedEquivalent,
        pocket: body.pocket,
        method: body.method,
        supplier_id: body.supplier_id,
        dzd: null,
        rate: body.rate_to_aed,
      })
      .select("id")
      .single();

    if (payIns.error || !payIns.data?.id) {
      return NextResponse.json(
        { error: payIns.error?.message || "Failed to log supplier payment" },
        { status: 400 }
      );
    }

    await admin.from("movements").insert({
      date: paymentDate,
      type: "Out",
      category: "Car Purchase",
      description: `Supplier payment for pre-order ${id}`,
      amount: body.amount,
      currency: body.currency,
      rate: body.rate_to_aed,
      aed_equivalent: aedEquivalent,
      pocket: body.pocket,
      deal_id: id,
      payment_id: payIns.data.id,
      reference: body.reference ?? "PREORDER-SUPPLIER-PAYMENT",
      status: "approved",
    });

    const { data: pocketPos } = await admin
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", body.pocket)
      .eq("currency", body.currency)
      .limit(1)
      .maybeSingle();
    if (pocketPos?.id) {
      await admin
        .from("cash_positions")
        .update({ amount: (pocketPos.amount || 0) - body.amount })
        .eq("id", pocketPos.id);
    }

    const dealUpdate = await admin
      .from("deals")
      .update({
        lifecycle_status: "ORDERED",
        status: "pending",
        inventory_car_id: carId,
        car_id: carId,
      })
      .eq("id", id);
    if (dealUpdate.error) {
      return NextResponse.json({ error: dealUpdate.error.message }, { status: 400 });
    }

    await admin
      .from("cars")
      .update({
        inventory_lifecycle_status: "INCOMING",
        linked_deal_id: id,
      })
      .eq("id", carId);

    return NextResponse.json({ ok: true, carId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
