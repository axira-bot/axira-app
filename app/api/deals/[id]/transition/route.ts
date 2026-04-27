import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transitionSchema } from "@/lib/services/preorders/schemas";
import {
  assertLifecycleTransition,
  getDealForTransition,
  requirePreorderAccess,
} from "@/lib/services/preorders/service";
import type { DealLifecycleStatus } from "@/lib/services/preorders/types";

export const dynamic = "force-dynamic";

function mapLifecycleToLegacyStatus(lifecycle: DealLifecycleStatus): "pending" | "closed" {
  return lifecycle === "CLOSED" ? "closed" : "pending";
}

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
    const parsed = transitionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const deal = await getDealForTransition(admin, id);
    const current = (deal.lifecycle_status || "PRE_ORDER") as DealLifecycleStatus;
    const next = parsed.data.to_status as DealLifecycleStatus;

    assertLifecycleTransition(current, next);

    if (next === "ORDERED") {
      return NextResponse.json(
        { error: "Use supplier-payment endpoint to move into ORDERED." },
        { status: 400 }
      );
    }

    if (next === "CLOSED") {
      const saleDzd = Number(deal.sale_dzd || 0);
      const collected = Number(deal.collected_dzd || 0);
      if (Math.abs(collected - saleDzd) > 1) {
        return NextResponse.json(
          { error: "Cannot close deal before full customer payment." },
          { status: 400 }
        );
      }
    }

    const legacyStatus = mapLifecycleToLegacyStatus(next);
    const updatePayload: Record<string, unknown> = {
      lifecycle_status: next,
      status: legacyStatus,
      cancellation_note: parsed.data.note ?? null,
    };
    if (next !== "CANCELLED") {
      updatePayload.cancellation_reason = null;
    }

    const { error } = await admin.from("deals").update(updatePayload).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (next === "ARRIVED" && deal.inventory_car_id) {
      await admin
        .from("cars")
        .update({
          inventory_lifecycle_status: "ARRIVED",
          status: "available",
          display_status: "available",
        })
        .eq("id", deal.inventory_car_id);
    }

    if (next === "CLOSED" && deal.inventory_car_id) {
      await admin
        .from("cars")
        .update({
          inventory_lifecycle_status: "DELIVERED",
          status: "sold",
          display_status: "sold",
          sold_at: new Date().toISOString(),
        })
        .eq("id", deal.inventory_car_id);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
