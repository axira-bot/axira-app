import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertLinkedPoPayment } from "@/lib/services/purchaseOrders/linkedPoPaymentInsert";
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
    const currency = (body.currency || "USD") as "USD" | "AED" | "DZD" | "EUR";
    const admin = createAdminClient();

    const inserted = await insertLinkedPoPayment(admin, {
      purchaseOrderId: id,
      date: body.date,
      amount,
      currency,
      rateSnapshot: body.rate_snapshot ?? null,
      pocket: body.pocket,
      method: body.method,
      notes: body.notes,
      createdBy: auth.user.id,
      supplierId: null,
    });
    if (!inserted.ok) {
      return NextResponse.json({ error: inserted.error }, { status: 400 });
    }

    await recomputePoTotals(id);
    return NextResponse.json({ row: inserted.row });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
