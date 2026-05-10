import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContractGenerationAccess } from "@/lib/contracts/auth";
import { finalizeGeneratedDocument } from "@/lib/contracts/finalize";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireContractGenerationAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as { deal_id?: string; payment_id?: string };
    const dealId = String(body.deal_id || "").trim();
    const paymentId = String(body.payment_id || "").trim();
    if (!dealId || !paymentId) {
      return NextResponse.json({ error: "deal_id and payment_id are required" }, { status: 400 });
    }
    const admin = createAdminClient();
    const finalized = await finalizeGeneratedDocument({
      admin,
      user: auth.user,
      mode: "receipt",
      dealId,
      paymentId,
    });
    return new NextResponse(new Uint8Array(finalized.generated.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${finalized.generated.fileName}"`,
        "x-generated-document-id": finalized.generatedDocumentId,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
