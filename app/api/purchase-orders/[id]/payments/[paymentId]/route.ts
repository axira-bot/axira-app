import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyMovementToCashPosition, reverseMovementOnCashPosition } from "@/lib/finance/applyCashPositionChange";
import { legacyRateInputToAedPerUnit, toAed } from "@/lib/finance/dealMoney";
import { validatePocketForCurrency } from "@/lib/finance/cashPockets";
import { convertCurrencyAmount, requirePoAccess, recomputePoTotals } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type Body = {
  date?: string;
  amount?: number;
  currency?: "USD" | "AED" | "DZD" | "EUR";
  rate_snapshot?: number | null;
  pocket?: string;
  method?: string | null;
  notes?: string | null;
};

async function logPoPaymentActivity(admin: ReturnType<typeof createAdminClient>, params: {
  userId: string;
  actorName: string | null;
  action: "deleted" | "updated";
  entityId: string;
  description: string;
  amount?: number | null;
  currency?: string | null;
}) {
  await admin.from("activity_log").insert({
    action: params.action,
    entity: "po_payment",
    entity_id: params.entityId,
    description: params.description,
    amount: params.amount ?? null,
    currency: params.currency ?? null,
    actor_user_id: params.userId,
    actor_name: params.actorName,
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; paymentId: string }> }
) {
  const auth = await requirePoAccess({ write: true, ownerOnly: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = createAdminClient();
  const { id: poId, paymentId } = await context.params;
  const body = (await request.json()) as Body;

  const { data: pop, error: popErr } = await admin
    .from("purchase_order_payments")
    .select("*")
    .eq("id", paymentId)
    .eq("purchase_order_id", poId)
    .maybeSingle();
  if (popErr || !pop) {
    return NextResponse.json({ error: "Payment not found for this PO." }, { status: 404 });
  }

  const oldPopRollback = {
    date: (pop as { date?: string | null }).date,
    amount: (pop as { amount?: number | null }).amount,
    currency: (pop as { currency?: string | null }).currency,
    rate_snapshot: (pop as { rate_snapshot?: number | null }).rate_snapshot,
    aed_equivalent: (pop as { aed_equivalent?: number | null }).aed_equivalent,
    amount_in_po_currency: (pop as { amount_in_po_currency?: number | null }).amount_in_po_currency,
    pocket: (pop as { pocket?: string | null }).pocket,
    method: (pop as { method?: string | null }).method,
    notes: (pop as { notes?: string | null }).notes,
  };

  const movementId = (pop as { movement_id?: string | null }).movement_id;
  if (!movementId) {
    return NextResponse.json({ error: "Payment has no linked movement; cannot edit safely." }, { status: 400 });
  }

  const { data: oldM, error: movErr } = await admin.from("movements").select("*").eq("id", movementId).maybeSingle();
  if (movErr || !oldM) {
    return NextResponse.json({ error: "Linked movement not found." }, { status: 400 });
  }

  const old = oldM as {
    id: string;
    date: string | null;
    type: string | null;
    amount: number | null;
    currency: string | null;
    pocket: string | null;
    rate: number | null;
    aed_equivalent: number | null;
    method: string | null;
    note: string | null;
  };

  const amount = body.amount != null ? Number(body.amount) : Number(old.amount || 0);
  if (amount <= 0) return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  const currency = (body.currency || old.currency || "USD") as "USD" | "AED" | "DZD" | "EUR";
  const pocket = (body.pocket ?? old.pocket ?? "").trim();
  const pocketErr = validatePocketForCurrency(pocket, currency);
  if (pocketErr) return NextResponse.json({ error: pocketErr }, { status: 400 });

  const date = body.date || old.date || new Date().toISOString().slice(0, 10);
  const rateRaw = body.rate_snapshot !== undefined ? body.rate_snapshot : (pop as { rate_snapshot?: number | null }).rate_snapshot;
  const rateToAed = legacyRateInputToAedPerUnit(currency, rateRaw);
  const aedEquivalent = toAed(amount, currency, rateToAed);

  const poRes = await admin.from("purchase_orders").select("currency").eq("id", poId).maybeSingle();
  const poCurrency = ((poRes.data as { currency?: string } | null)?.currency || "USD") as "USD" | "AED" | "DZD" | "EUR";
  const amountInPoCurrency = convertCurrencyAmount({
    amount,
    fromCurrency: currency,
    toCurrency: poCurrency,
    rateSnapshot: rateRaw,
    aedEquivalent,
  });

  const rev = await reverseMovementOnCashPosition(admin, {
    pocket: old.pocket,
    currency: old.currency,
    amount: old.amount,
    type: old.type,
  });
  if (!rev.ok) {
    return NextResponse.json({ error: `Could not reverse prior pocket balance: ${rev.error}` }, { status: 400 });
  }

  const movPayload = {
    date,
    type: "Out",
    category: "Car Purchase",
    amount,
    currency,
    rate: rateToAed,
    aed_equivalent: aedEquivalent,
    pocket,
    method: body.method ?? old.method ?? "bank_transfer",
    note: body.notes ?? old.note ?? "Purchase order payment",
    status: "posted",
  };

  const { error: movUpdErr } = await admin.from("movements").update(movPayload).eq("id", movementId);
  if (movUpdErr) {
    await applyMovementToCashPosition(admin, {
      pocket: old.pocket!,
      currency: old.currency!,
      amount: Number(old.amount || 0),
      type: old.type || "Out",
    });
    return NextResponse.json({ error: movUpdErr.message ?? "Failed to update movement" }, { status: 400 });
  }

  const paymentIdRow = (pop as { payment_id?: string | null }).payment_id;
  if (paymentIdRow) {
    await admin
      .from("payments")
      .update({
        amount,
        currency,
        rate_to_aed: rateToAed,
        aed_equivalent: aedEquivalent,
        pocket,
        method: body.method ?? undefined,
        notes: body.notes ?? undefined,
      })
      .eq("id", paymentIdRow);
  }

  const { data: updatedPop, error: popUpdErr } = await admin
    .from("purchase_order_payments")
    .update({
      date,
      amount,
      currency,
      rate_snapshot: rateRaw,
      aed_equivalent: aedEquivalent,
      amount_in_po_currency: amountInPoCurrency,
      pocket,
      method: body.method ?? (pop as { method?: string | null }).method,
      notes: body.notes !== undefined ? body.notes : (pop as { notes?: string | null }).notes,
    })
    .eq("id", paymentId)
    .select("*")
    .single();

  if (popUpdErr || !updatedPop) {
    await admin.from("movements").update({
      date: old.date,
      type: old.type,
      amount: old.amount,
      currency: old.currency,
      rate: old.rate,
      aed_equivalent: old.aed_equivalent,
      pocket: old.pocket,
      method: old.method,
      note: old.note,
    }).eq("id", movementId);
    if (paymentIdRow) {
      await admin
        .from("payments")
        .update({
          amount: Number((pop as { amount?: number }).amount ?? old.amount),
          currency: (pop as { currency?: string }).currency ?? old.currency,
          rate_to_aed: old.rate,
          aed_equivalent: old.aed_equivalent,
          pocket: old.pocket,
          method: (pop as { method?: string | null }).method ?? undefined,
          notes: (pop as { notes?: string | null }).notes ?? undefined,
        })
        .eq("id", paymentIdRow);
    }
    await applyMovementToCashPosition(admin, {
      pocket: old.pocket!,
      currency: old.currency!,
      amount: Number(old.amount || 0),
      type: old.type || "Out",
    });
    return NextResponse.json({ error: popUpdErr?.message ?? "Failed to update PO payment" }, { status: 400 });
  }

  const apply = await applyMovementToCashPosition(admin, {
    pocket,
    currency,
    amount,
    type: "Out",
  });
  if (!apply.ok) {
    await admin.from("movements").update({
      date: old.date,
      type: old.type,
      amount: old.amount,
      currency: old.currency,
      rate: old.rate,
      aed_equivalent: old.aed_equivalent,
      pocket: old.pocket,
      method: old.method,
      note: old.note,
    }).eq("id", movementId);
    await admin.from("purchase_order_payments").update(oldPopRollback).eq("id", paymentId);
    if (paymentIdRow) {
      await admin
        .from("payments")
        .update({
          amount: Number((pop as { amount?: number }).amount ?? old.amount),
          currency: (pop as { currency?: string }).currency ?? old.currency,
          rate_to_aed: old.rate,
          aed_equivalent: old.aed_equivalent,
          pocket: old.pocket,
          method: (pop as { method?: string | null }).method ?? undefined,
          notes: (pop as { notes?: string | null }).notes ?? undefined,
        })
        .eq("id", paymentIdRow);
    }
    await applyMovementToCashPosition(admin, {
      pocket: old.pocket!,
      currency: old.currency!,
      amount: Number(old.amount || 0),
      type: old.type || "Out",
    });
    return NextResponse.json({ error: `Could not apply new pocket balance: ${apply.error}` }, { status: 400 });
  }

  await recomputePoTotals(poId);

  const { data: prof } = await admin.from("user_profiles").select("name").eq("id", auth.user.id).maybeSingle();
  const actorName = (prof as { name?: string | null } | null)?.name?.trim() || null;
  await logPoPaymentActivity(admin, {
    userId: auth.user.id,
    actorName,
    action: "updated",
    entityId: paymentId,
    description: `PO payment updated — PO ${poId.slice(0, 8)} — ${amount} ${currency} (${pocket})`,
    amount,
    currency,
  });

  return NextResponse.json({ row: updatedPop });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; paymentId: string }> }
) {
  const auth = await requirePoAccess({ write: true, ownerOnly: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = createAdminClient();
  const { id: poId, paymentId } = await context.params;

  const { data: pop, error: popErr } = await admin
    .from("purchase_order_payments")
    .select("*")
    .eq("id", paymentId)
    .eq("purchase_order_id", poId)
    .maybeSingle();
  if (popErr || !pop) {
    return NextResponse.json({ error: "Payment not found for this PO." }, { status: 404 });
  }

  const movementId = (pop as { movement_id?: string | null }).movement_id;
  const paymentRowId = (pop as { payment_id?: string | null }).payment_id;

  type MovCashRow = {
    pocket: string | null;
    currency: string | null;
    amount: number | null;
    type: string | null;
  };
  let movementRow: MovCashRow | null = null;
  if (movementId) {
    const { data: m } = await admin
      .from("movements")
      .select("pocket, currency, amount, type")
      .eq("id", movementId)
      .maybeSingle();
    movementRow = (m as MovCashRow | null) ?? null;
  }

  if (movementRow) {
    const rev = await reverseMovementOnCashPosition(admin, movementRow);
    if (!rev.ok) {
      return NextResponse.json({ error: `Could not restore pocket balance: ${rev.error}` }, { status: 400 });
    }
  }

  const { error: delPop } = await admin.from("purchase_order_payments").delete().eq("id", paymentId);
  if (delPop) {
    if (movementRow) {
      await applyMovementToCashPosition(admin, {
        pocket: movementRow.pocket!,
        currency: movementRow.currency!,
        amount: Number(movementRow.amount || 0),
        type: movementRow.type || "Out",
      });
    }
    return NextResponse.json({ error: delPop.message ?? "Failed to delete PO payment row" }, { status: 400 });
  }

  if (movementId) {
    const { error: delM } = await admin.from("movements").delete().eq("id", movementId);
    if (delM) {
      return NextResponse.json({ error: delM.message ?? "Failed to delete movement" }, { status: 400 });
    }
  }

  if (paymentRowId) {
    await admin.from("payments").delete().eq("id", paymentRowId);
  }

  await recomputePoTotals(poId);

  const { data: prof } = await admin.from("user_profiles").select("name").eq("id", auth.user.id).maybeSingle();
  const actorName = (prof as { name?: string | null } | null)?.name?.trim() || null;
  const amt = Number((pop as { amount?: number }).amount || 0);
  const cur = String((pop as { currency?: string }).currency || "");
  await logPoPaymentActivity(admin, {
    userId: auth.user.id,
    actorName,
    action: "deleted",
    entityId: paymentId,
    description: `PO payment deleted — PO ${poId.slice(0, 8)} — ${amt} ${cur}`,
    amount: amt,
    currency: cur,
  });

  return NextResponse.json({ ok: true });
}
