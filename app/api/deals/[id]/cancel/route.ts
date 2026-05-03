import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toAed } from "@/lib/finance/dealMoney";
import { cancelSchema } from "@/lib/services/preorders/schemas";
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
    const parsed = cancelSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const deal = await getDealForTransition(admin, id);

    const { data: depositRows } = await admin
      .from("payments")
      .select("id, amount, dzd, pocket, currency, rate_to_aed")
      .eq("deal_id", id)
      .eq("kind", "customer_deposit");
    const depositTotal = ((depositRows as { amount?: number | null; dzd?: number | null }[] | null) || [])
      .reduce((sum, p) => sum + Number(p.amount ?? p.dzd ?? 0), 0);

    if (depositTotal > 0 && !parsed.data.deposit_action) {
      return NextResponse.json(
        { error: "Deposit action is required when deposit exists." },
        { status: 400 }
      );
    }

    await admin
      .from("deals")
      .update({
        lifecycle_status: "CANCELLED",
        status: "pending",
        cancellation_reason: parsed.data.reason,
        cancellation_note: parsed.data.note ?? null,
      })
      .eq("id", id);

    if (depositTotal > 0 && parsed.data.deposit_action) {
      const actionKind = parsed.data.deposit_action === "refund" ? "refund" : "forfeit";
      const amount = depositTotal;
      const row = (depositRows?.[0] || {}) as {
        pocket?: string | null;
        currency?: string | null;
        rate_to_aed?: number | null;
      };
      const pocket = row.pocket || "Algeria Cash";
      const currency = row.currency || "DZD";
      const rateToAed =
        row.rate_to_aed != null && row.rate_to_aed > 0 ? row.rate_to_aed : currency === "AED" ? 1 : 1;
      const aedEq = toAed(amount, currency, rateToAed);
      const payDate = new Date().toISOString().slice(0, 10);
      const direction = parsed.data.deposit_action === "refund" ? "Out" : "In";

      const payIns = await admin
        .from("payments")
        .insert({
          deal_id: id,
          date: payDate,
          type: actionKind,
          notes: parsed.data.note ?? null,
          kind: actionKind,
          currency,
          amount,
          pocket,
          method: "cash",
          rate_to_aed: rateToAed,
          aed_equivalent: aedEq,
          dzd: currency === "DZD" ? amount : null,
          rate: rateToAed,
        })
        .select("id")
        .single();

      if (payIns.error || !payIns.data?.id) {
        await admin
          .from("deals")
          .update({
            lifecycle_status: deal.lifecycle_status,
            status: deal.status ?? "pending",
            cancellation_reason: null,
            cancellation_note: null,
          })
          .eq("id", id);
        return NextResponse.json(
          {
            error:
              payIns.error?.message || "Failed to record deposit refund/forfeit payment",
          },
          { status: 400 }
        );
      }

      await admin.from("movements").insert({
        date: payDate,
        type: direction,
        category: "Other",
        description: `Pre-order ${actionKind}`,
        amount,
        currency,
        rate: rateToAed,
        aed_equivalent: aedEq,
        pocket,
        payment_id: payIns.data.id,
        deal_id: id,
        reference: "PREORDER-CANCEL",
      });
    }

    if (deal.inventory_car_id) {
      if (!parsed.data.inventory_action) {
        return NextResponse.json(
          { error: "Inventory action is required once supplier-side inventory exists." },
          { status: 400 }
        );
      }

      if (parsed.data.inventory_action === "convert_to_stock") {
        await admin
          .from("cars")
          .update({
            linked_deal_id: null,
            inventory_lifecycle_status: "IN_STOCK",
            status: "available",
            display_status: "available",
          })
          .eq("id", deal.inventory_car_id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
