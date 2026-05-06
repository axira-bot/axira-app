import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContractGenerationAccess } from "@/lib/contracts/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireContractGenerationAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as { generated_document_id?: string };
    const id = String(body.generated_document_id || "").trim();
    if (!id) return NextResponse.json({ error: "generated_document_id is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data: doc, error } = await admin
      .from("generated_documents")
      .select("id, file_url")
      .eq("id", id)
      .single();
    if (error || !doc?.file_url) return NextResponse.json({ error: error?.message || "Document not found" }, { status: 404 });
    const signed = await admin.storage.from("contracts").createSignedUrl(String(doc.file_url), 60 * 5);
    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json({ error: signed.error?.message || "Failed to create signed URL" }, { status: 400 });
    }
    return NextResponse.json({ url: signed.data.signedUrl, expires_in_seconds: 300 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
