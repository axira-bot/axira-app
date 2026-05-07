import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess } from "@/lib/services/purchaseOrders/service";
import { isValidIsoVin, normalizeVin } from "@/lib/vin/isoVin";

export const dynamic = "force-dynamic";

type Body = {
  car_id?: string;
  purchase_order_id?: string;
  vin?: string;
  confirm_override?: boolean;
  override_reason?: string | null;
};

function translateRpcMessage(message: string): { status: number; error: string } {
  const m = (message || "").trim();
  if (m.includes("INVALID_VIN_FORMAT")) {
    return { status: 400, error: "Invalid VIN. Use 17 characters (A–Z except I, O, Q, and digits 0–9)." };
  }
  if (m.includes("VIN_ALREADY_VALIDATED")) {
    return { status: 409, error: "This VIN is already validated. Owners can change it with confirmation." };
  }
  if (m.includes("NOT_YET_VALIDATED")) {
    return { status: 400, error: "Use validate first; this car does not have a validated VIN yet." };
  }
  if (m.includes("CAR_NOT_FOUND")) {
    return { status: 404, error: "Car not found." };
  }
  return { status: 400, error: m || "VIN update failed" };
}

export async function POST(request: NextRequest) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as Body;
    const carId = String(body.car_id || "").trim();
    const poId = String(body.purchase_order_id || "").trim();
    const vinRaw = String(body.vin ?? "");
    if (!carId || !poId) {
      return NextResponse.json({ error: "car_id and purchase_order_id are required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: car, error: carErr } = await admin
      .from("cars")
      .select("id, purchase_order_id, vin_validated_at")
      .eq("id", carId)
      .maybeSingle();
    if (carErr) return NextResponse.json({ error: carErr.message }, { status: 400 });
    if (!car) return NextResponse.json({ error: "Car not found" }, { status: 404 });

    const row = car as { id: string; purchase_order_id: string | null; vin_validated_at: string | null };
    if (row.purchase_order_id !== poId) {
      return NextResponse.json({ error: "This car is not linked to the given purchase order." }, { status: 403 });
    }

    const normalized = normalizeVin(vinRaw);
    if (!isValidIsoVin(normalized)) {
      return NextResponse.json(
        { error: "Invalid VIN. Use 17 characters (A–Z except I, O, Q, and digits 0–9)." },
        { status: 400 }
      );
    }

    const already = row.vin_validated_at != null;

    if (already) {
      if (auth.role !== "owner") {
        return NextResponse.json(
          { error: "Only an owner can change a validated VIN. Ask an owner to update it." },
          { status: 403 }
        );
      }
      if (body.confirm_override !== true) {
        return NextResponse.json(
          { error: "confirm_override must be true to replace a validated VIN." },
          { status: 400 }
        );
      }
      const rpc = await admin.rpc("owner_override_car_vin_with_audit", {
        p_car_id: carId,
        p_new_vin: normalized,
        p_user_id: auth.user.id,
        p_reason: body.override_reason ?? null,
      });
      if (rpc.error) {
        const mapped = translateRpcMessage(rpc.error.message);
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      return NextResponse.json({ ok: true as const, mode: "override" as const });
    }

    const rpc = await admin.rpc("validate_car_vin_with_audit", {
      p_car_id: carId,
      p_vin: normalized,
      p_user_id: auth.user.id,
    });
    if (rpc.error) {
      const mapped = translateRpcMessage(rpc.error.message);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    return NextResponse.json({ ok: true as const, mode: "validate" as const });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
