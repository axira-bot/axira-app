import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContractGenerationAccess } from "@/lib/contracts/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireContractGenerationAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const dealId = (request.nextUrl.searchParams.get("deal_id") || "").trim();
    if (!dealId) return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    const admin = createAdminClient();
    const docsRes = await admin
      .from("generated_documents")
      .select("*")
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false });
    if (docsRes.error) return NextResponse.json({ error: docsRes.error.message }, { status: 400 });
    const rows = (docsRes.data || []) as Array<Record<string, unknown>>;
    const userIds = Array.from(new Set(rows.map((r) => String(r.generated_by || "")).filter(Boolean)));
    let names: Record<string, string> = {};
    if (userIds.length) {
      const usersRes = await admin.from("user_profiles").select("id, name").in("id", userIds);
      if (!usersRes.error) {
        names = Object.fromEntries(((usersRes.data || []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name || "Unknown"]));
      }
    }
    return NextResponse.json({
      rows: rows.map((r) => ({
        ...r,
        generated_by_name: names[String(r.generated_by || "")] || "Unknown",
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
