import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePoAccess } from "@/lib/services/purchaseOrders/service";

export const dynamic = "force-dynamic";

type SupplierRow = {
  id: string;
  name: string;
  country: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  default_currency: string | null;
  active: boolean;
  created_at: string | null;
};

export async function GET() {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("suppliers")
      .select("id, name, country, contact_name, contact_phone, default_currency, active, created_at")
      .order("name", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ rows: (data as SupplierRow[]) ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type PostBody = {
  name?: string;
  country?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  default_currency?: "USD" | "AED" | null;
  active?: boolean;
};

export async function POST(request: NextRequest) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as PostBody;
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("suppliers")
      .insert({
        name,
        country: body.country?.trim() || null,
        contact_name: body.contact_name?.trim() || null,
        contact_phone: body.contact_phone?.trim() || null,
        default_currency: body.default_currency || "USD",
        active: body.active !== false,
        updated_at: new Date().toISOString(),
      })
      .select("id, name, country, contact_name, contact_phone, default_currency, active, created_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ row: data }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type PatchBody = {
  id?: string;
  name?: string;
  country?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  default_currency?: "USD" | "AED" | null;
  active?: boolean;
};

export async function PATCH(request: NextRequest) {
  const auth = await requirePoAccess({ write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as PatchBody;
    const id = (body.id || "").trim();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const admin = createAdminClient();
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) payload.name = String(body.name).trim();
    if (body.country !== undefined) payload.country = body.country?.trim() || null;
    if (body.contact_name !== undefined) payload.contact_name = body.contact_name?.trim() || null;
    if (body.contact_phone !== undefined) payload.contact_phone = body.contact_phone?.trim() || null;
    if (body.default_currency !== undefined) payload.default_currency = body.default_currency || null;
    if (body.active !== undefined) payload.active = Boolean(body.active);
    const { data, error } = await admin
      .from("suppliers")
      .update(payload)
      .eq("id", id)
      .select("id, name, country, contact_name, contact_phone, default_currency, active, created_at")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
    return NextResponse.json({ row: data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
