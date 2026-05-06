import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContractGenerationAccess } from "@/lib/contracts/auth";
import { generateContractDocument } from "@/lib/contracts/generate";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireContractGenerationAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as { deal_id?: string };
    const dealId = String(body.deal_id || "").trim();
    if (!dealId) return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    const admin = createAdminClient();
    const generated = await generateContractDocument("agreement", { admin, dealId });
    const objectPath = generated.storagePath;
    const upload = await admin.storage.from("contracts").upload(objectPath, generated.buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
    });
    if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 400 });
    const inserted = await admin
      .from("generated_documents")
      .insert({
        deal_id: dealId,
        payment_id: null,
        document_type: "agreement",
        file_url: objectPath,
        generated_by: auth.user.id,
      })
      .select("id")
      .single();
    if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 400 });
    return new NextResponse(new Uint8Array(generated.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${generated.fileName}"`,
        "x-generated-document-id": inserted.data.id,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
