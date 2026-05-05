import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesCatalogAdmin } from "@/lib/services/salesList/access";

export const dynamic = "force-dynamic";

type Body = Partial<{
  brand: string;
  model: string;
  year: number | null;
  color_options: string[] | null;
  trim: string | null;
  supplier_id: string | null;
  supplier_reference: string | null;
  sale_price_dzd: number;
  lead_time_days: number;
  deposit_amount_dzd: number;
  photos: string[] | null;
  internal_note: string | null;
  cost_estimate_dzd: number | null;
  margin_note: string | null;
  buyer_responsibilities_note: string | null;
  active: boolean;
}>;

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSalesCatalogAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const body = (await request.json()) as Body;
  const admin = createAdminClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.brand !== undefined) patch.brand = String(body.brand).trim();
  if (body.model !== undefined) patch.model = String(body.model).trim();
  if (body.year !== undefined) patch.year = body.year;
  if (body.color_options !== undefined) patch.color_options = body.color_options ?? [];
  if (body.trim !== undefined) patch.trim = body.trim;
  if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id;
  if (body.supplier_reference !== undefined) patch.supplier_reference = body.supplier_reference;
  if (body.sale_price_dzd !== undefined) patch.sale_price_dzd = Number(body.sale_price_dzd);
  if (body.lead_time_days !== undefined) patch.lead_time_days = Number(body.lead_time_days);
  if (body.deposit_amount_dzd !== undefined) patch.deposit_amount_dzd = Number(body.deposit_amount_dzd);
  if (body.photos !== undefined) patch.photos = body.photos ?? [];
  if (body.internal_note !== undefined) patch.internal_note = body.internal_note;
  if (body.cost_estimate_dzd !== undefined) patch.cost_estimate_dzd = body.cost_estimate_dzd;
  if (body.margin_note !== undefined) patch.margin_note = body.margin_note;
  if (body.buyer_responsibilities_note !== undefined) patch.buyer_responsibilities_note = body.buyer_responsibilities_note;
  if (body.active !== undefined) patch.active = Boolean(body.active);

  const { data, error } = await admin.from("sales_catalog_entries").update(patch).eq("id", id).select("*").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  return NextResponse.json({ row: data });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSalesCatalogAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { error } = await admin.from("sales_catalog_entries").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
