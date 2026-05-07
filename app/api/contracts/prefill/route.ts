import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContractGenerationAccess } from "@/lib/contracts/auth";
import { loadPrefillData } from "@/lib/contracts/prefill";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireContractGenerationAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as {
      mode?: "agreement" | "receipt";
      deal_id?: string;
      payment_id?: string;
    };
    const mode = body.mode === "receipt" ? "receipt" : "agreement";
    const dealId = String(body.deal_id || "").trim();
    const paymentId = String(body.payment_id || "").trim();
    if (!dealId) return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    if (mode === "receipt" && !paymentId) {
      return NextResponse.json({ error: "payment_id is required for receipt" }, { status: 400 });
    }
    const admin = createAdminClient();
    const result = await loadPrefillData({ admin, dealId, mode, paymentId: paymentId || undefined });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
