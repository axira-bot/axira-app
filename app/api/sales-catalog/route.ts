import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesCatalogAdmin } from "@/lib/services/salesList/access";

export const dynamic = "force-dynamic";

type Body = {
  brand: string;
  model: string;
  year?: number | null;
  color_options?: string[] | null;
  trim?: string | null;
  supplier_id?: string | null;
  supplier_reference?: string | null;
  sale_price_dzd: number;
  lead_time_days: number;
  deposit_amount_dzd: number;
  photos?: string[] | null;
  internal_note?: string | null;
  cost_estimate_dzd?: number | null;
  margin_note?: string | null;
  buyer_responsibilities_note?: string | null;
  active?: boolean;
};

export async function GET() {
  const auth = await requireSalesCatalogAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = createAdminClient();
  const { data, error } = await admin.from("sales_catalog_entries").select("*").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesCatalogAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await request.json()) as Body;
  if (!body.brand?.trim() || !body.model?.trim()) {
    return NextResponse.json({ error: "brand and model are required" }, { status: 400 });
  }
  const sale = Number(body.sale_price_dzd);
  const lead = Number(body.lead_time_days);
  const dep = Number(body.deposit_amount_dzd);
  if (!Number.isFinite(sale) || sale < 0) return NextResponse.json({ error: "Invalid sale_price_dzd" }, { status: 400 });
  if (!Number.isFinite(lead) || lead < 0) return NextResponse.json({ error: "Invalid lead_time_days" }, { status: 400 });
  if (!Number.isFinite(dep) || dep < 0) return NextResponse.json({ error: "Invalid deposit_amount_dzd" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sales_catalog_entries")
    .insert({
      brand: body.brand.trim(),
      model: body.model.trim(),
      year: body.year ?? null,
      color_options: Array.isArray(body.color_options) ? body.color_options : [],
      trim: body.trim ?? null,
      supplier_id: body.supplier_id ?? null,
      supplier_reference: body.supplier_reference ?? null,
      sale_price_dzd: sale,
      lead_time_days: lead,
      deposit_amount_dzd: dep,
      photos: Array.isArray(body.photos) ? body.photos : [],
      internal_note: body.internal_note ?? null,
      cost_estimate_dzd: body.cost_estimate_dzd ?? null,
      margin_note: body.margin_note ?? null,
      buyer_responsibilities_note: body.buyer_responsibilities_note ?? null,
      active: body.active !== false,
      created_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });
  return NextResponse.json({ row: data }, { status: 201 });
}
