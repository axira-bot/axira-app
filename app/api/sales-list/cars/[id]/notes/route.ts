import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditSalesNotes, requireSalesListRead } from "@/lib/services/salesList/access";

export const dynamic = "force-dynamic";

async function resolveUserDisplayName(admin: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data: profile } = await admin.from("user_profiles").select("name").eq("id", userId).maybeSingle();
  const name = (profile as { name?: string | null } | null)?.name?.trim();
  if (name) return name;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return data.user.email ?? null;
}

async function handleNotesUpdate(request: NextRequest, carId: string) {
  const auth = await requireSalesListRead();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canEditSalesNotes(auth)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = body as { sales_notes?: unknown };
  const sales_notes = typeof raw.sales_notes === "string" ? raw.sales_notes : "";

  const admin = createAdminClient();
  const { data: car, error: carErr } = await admin.from("cars").select("id").eq("id", carId).maybeSingle();
  if (carErr) return NextResponse.json({ error: carErr.message }, { status: 400 });
  if (!car) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const normalized = sales_notes.trim() === "" ? null : sales_notes;
  const { error: upErr } = await admin
    .from("cars")
    .update({
      sales_notes: normalized,
      sales_notes_updated_at: new Date().toISOString(),
      sales_notes_updated_by: auth.userId,
    })
    .eq("id", carId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const { data: row } = await admin
    .from("cars")
    .select("sales_notes, sales_notes_updated_at, sales_notes_updated_by")
    .eq("id", carId)
    .single();

  const r = row as {
    sales_notes: string | null;
    sales_notes_updated_at: string | null;
    sales_notes_updated_by: string | null;
  } | null;

  const sales_notes_updated_by_name = await resolveUserDisplayName(admin, r?.sales_notes_updated_by ?? null);

  return NextResponse.json({
    sales_notes: r?.sales_notes ?? null,
    sales_notes_updated_at: r?.sales_notes_updated_at ?? null,
    sales_notes_updated_by: r?.sales_notes_updated_by ?? null,
    sales_notes_updated_by_name,
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleNotesUpdate(request, id);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleNotesUpdate(request, id);
}
