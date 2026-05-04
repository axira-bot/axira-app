import type { SupabaseClient } from "@supabase/supabase-js";
import { applyMovementToCashPosition } from "@/lib/finance/applyCashPositionChange";
import { validatePocketForCurrency } from "@/lib/finance/cashPockets";
import { legacyRateInputToAedPerUnit, toAed } from "@/lib/finance/dealMoney";
import { convertCurrencyAmount } from "@/lib/services/purchaseOrders/service";

type Currency = "USD" | "AED" | "DZD" | "EUR";

export type InsertLinkedPoPaymentInput = {
  purchaseOrderId: string;
  date?: string;
  amount: number;
  currency: Currency;
  rateSnapshot: number | null;
  pocket: string | undefined | null;
  method?: string | null;
  notes?: string | null;
  createdBy: string;
  supplierId?: string | null;
};

export async function insertLinkedPoPayment(
  admin: SupabaseClient,
  input: InsertLinkedPoPaymentInput
): Promise<{ ok: true; row: unknown } | { ok: false; error: string }> {
  const pocket = (input.pocket ?? "").trim();
  const pocketErr = validatePocketForCurrency(pocket, input.currency);
  if (pocketErr) return { ok: false, error: pocketErr };

  const rateToAed = legacyRateInputToAedPerUnit(input.currency, input.rateSnapshot);
  const aedEquivalent = toAed(input.amount, input.currency, rateToAed);

  const poRes = await admin.from("purchase_orders").select("currency").eq("id", input.purchaseOrderId).maybeSingle();
  const poCurrency = ((poRes.data as { currency?: string } | null)?.currency || "USD") as Currency;
  const amountInPoCurrency = convertCurrencyAmount({
    amount: input.amount,
    fromCurrency: input.currency,
    toCurrency: poCurrency,
    rateSnapshot: input.rateSnapshot,
    aedEquivalent,
  });

  const payIns = await admin
    .from("payments")
    .insert({
      kind: "supplier_payment",
      amount: input.amount,
      currency: input.currency,
      rate_to_aed: rateToAed,
      aed_equivalent: aedEquivalent,
      pocket,
      method: input.method || "bank_transfer",
      notes: input.notes || `PO payment ${input.purchaseOrderId}`,
      supplier_id: input.supplierId ?? null,
      status: "paid",
    })
    .select("id")
    .single();
  if (payIns.error || !payIns.data?.id) {
    return { ok: false, error: payIns.error?.message ?? "Failed to insert payment" };
  }
  const paymentRowId = payIns.data.id as string;

  const movIns = await admin
    .from("movements")
    .insert({
      date: input.date || new Date().toISOString().slice(0, 10),
      type: "Out",
      category: "Car Purchase",
      amount: input.amount,
      currency: input.currency,
      rate: rateToAed,
      aed_equivalent: aedEquivalent,
      pocket,
      method: input.method || "bank_transfer",
      reference: `po:${input.purchaseOrderId}:payment:${paymentRowId}`,
      note: input.notes || `Purchase order payment`,
      status: "posted",
    })
    .select("id")
    .single();
  if (movIns.error || !movIns.data?.id) {
    await admin.from("payments").delete().eq("id", paymentRowId);
    return { ok: false, error: movIns.error?.message ?? "Failed to insert movement" };
  }
  const movementRowId = movIns.data.id as string;

  const poPayment = await admin
    .from("purchase_order_payments")
    .insert({
      purchase_order_id: input.purchaseOrderId,
      date: input.date || new Date().toISOString().slice(0, 10),
      amount: input.amount,
      currency: input.currency,
      rate_snapshot: input.rateSnapshot,
      aed_equivalent: aedEquivalent,
      amount_in_po_currency: amountInPoCurrency,
      pocket,
      method: input.method || "bank_transfer",
      notes: input.notes || null,
      movement_id: movementRowId,
      payment_id: paymentRowId,
      created_by: input.createdBy,
    })
    .select("*")
    .single();

  if (poPayment.error || !poPayment.data) {
    await admin.from("movements").delete().eq("id", movementRowId);
    await admin.from("payments").delete().eq("id", paymentRowId);
    return { ok: false, error: poPayment.error?.message ?? "Failed to insert PO payment" };
  }

  const apply = await applyMovementToCashPosition(admin, {
    pocket,
    currency: input.currency,
    amount: input.amount,
    type: "Out",
  });
  if (!apply.ok) {
    const popId = (poPayment.data as { id: string }).id;
    await admin.from("purchase_order_payments").delete().eq("id", popId);
    await admin.from("movements").delete().eq("id", movementRowId);
    await admin.from("payments").delete().eq("id", paymentRowId);
    return { ok: false, error: apply.error };
  }

  return { ok: true, row: poPayment.data };
}
