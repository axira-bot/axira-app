import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess } from "@/lib/services/purchaseOrders/service";
import { isCarLifecycleStatus } from "@/lib/cars/carLifecycleStatus";

export const dynamic = "force-dynamic";

type Body = {
  car_ids?: unknown;
  lifecycle_status?: unknown;
};

function mapLifecycleRpcError(message: string): { status: number; error: string } {
  const m = message || "";
  if (m.includes("NO_CARS_SELECTED")) return { status: 400, error: "Select at least one car." };
  if (m.includes("INVALID_LIFECYCLE_STATUS")) return { status: 400, error: "Invalid lifecycle status." };
  if (m.includes("CAR_NOT_LINKED_TO_PO")) {
    return { status: 403, error: "One or more cars are not linked to this purchase order." };
  }
  return { status: 400, error: m.trim() || "Lifecycle update failed" };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const poId = (await context.params).id.trim();
    if (!poId) return NextResponse.json({ error: "Missing purchase order id" }, { status: 400 });

    const body = (await request.json()) as Body;
    const lifecycleStatusRaw = typeof body.lifecycle_status === "string" ? body.lifecycle_status.trim() : "";
    if (!isCarLifecycleStatus(lifecycleStatusRaw)) {
      return NextResponse.json({ error: "Invalid lifecycle status." }, { status: 400 });
    }

    const rawIds = body.car_ids;
    const ids = Array.isArray(rawIds)
      ? [...new Set(rawIds.map((x) => String(x ?? "").trim()).filter(Boolean))]
      : [];
    if (!ids.length) {
      return NextResponse.json({ error: "car_ids must be a non-empty array of UUIDs." }, { status: 400 });
    }

    const admin = createAdminClient();
    const rpc = await admin.rpc("update_po_linked_cars_lifecycle", {
      p_po_id: poId,
      p_car_ids: ids,
      p_new_status: lifecycleStatusRaw,
      p_user_id: auth.user.id,
    });
    if (rpc.error) {
      const mapped = mapLifecycleRpcError(rpc.error.message);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    const count = typeof rpc.data === "number" ? rpc.data : Number(rpc.data ?? 0);
    return NextResponse.json({ ok: true as const, updated_count: count });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
