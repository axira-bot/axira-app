import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignVinSchema } from "@/lib/services/preorders/schemas";
import { requirePreorderAccess } from "@/lib/services/preorders/service";

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
    const parsed = assignVinSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: car, error: carErr } = await admin
      .from("cars")
      .select("id, linked_deal_id")
      .eq("id", id)
      .single();
    if (carErr || !car) {
      return NextResponse.json({ error: carErr?.message || "Car not found" }, { status: 404 });
    }

    const { error: updateErr } = await admin
      .from("cars")
      .update({
        vin: parsed.data.vin,
        inventory_lifecycle_status: "IN_TRANSIT",
        status: "in_transit",
        display_status: "in_transit",
      })
      .eq("id", id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    const linkedDealId = (car as { linked_deal_id?: string | null }).linked_deal_id ?? null;
    if (linkedDealId) {
      await admin
        .from("deals")
        .update({ lifecycle_status: "SHIPPED", status: "pending" })
        .eq("id", linkedDealId);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
