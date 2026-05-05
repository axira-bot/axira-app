import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesListRead } from "@/lib/services/salesList/access";

export const dynamic = "force-dynamic";

function stripCatalogForStaff<T extends Record<string, unknown>>(row: T): T {
  const { internal_note: _i, cost_estimate_dzd: _c, margin_note: _m, supplier_id: _s, supplier_reference: _r, ...rest } =
    row;
  return rest as T;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSalesListRead();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data, error } = await admin.from("sales_catalog_entries").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = data as Record<string, unknown>;
  if (!row.active && !auth.canSeeInternal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const out = auth.canSeeInternal ? row : stripCatalogForStaff(row);
  return NextResponse.json({ row: out });
}
