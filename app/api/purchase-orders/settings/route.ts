import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requirePoAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "po_deal_eligibility")
    .maybeSingle();
  const value = ((data as { value?: string | null } | null)?.value || "in_transit_or_arrived").trim();
  return NextResponse.json({
    po_deal_eligibility:
      value === "arrived_only" || value === "in_transit_or_arrived"
        ? value
        : "in_transit_or_arrived",
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await request.json()) as { po_deal_eligibility?: string };
  const value = (body.po_deal_eligibility || "").trim();
  if (value !== "arrived_only" && value !== "in_transit_or_arrived") {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert(
      { key: "po_deal_eligibility", value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, po_deal_eligibility: value });
}
