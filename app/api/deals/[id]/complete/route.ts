import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

type CompleteBody = {
  purchase_cost?: number;
  purchase_currency?: "AED" | "USD" | "DZD" | "EUR";
  purchase_rate?: number | null;
  shipping_cost?: number;
  customs_cost?: number;
  inspection_cost?: number;
  recovery_cost?: number;
  maintenance_cost?: number;
  other_expenses?: number;
  supplier_id?: string | null;
  supplier_name?: string | null;
  internal_notes?: string | null;
};

async function requireManagerOrOwner() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" };
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role =
    normalizeRole((profile as { role?: string } | null)?.role) ||
    normalizeRole((user.app_metadata as { role?: string } | null)?.role) ||
    "staff";
  const allowed = ["owner", "manager", "admin", "super_admin"].includes(role);
  if (!allowed) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, user, role };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireManagerOrOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await context.params;
    const body = (await request.json()) as CompleteBody;
    const admin = createAdminClient();

    const { error: costErr } = await admin.from("deal_costs").upsert(
      {
        deal_id: id,
        purchase_cost: Number(body.purchase_cost || 0),
        purchase_currency: body.purchase_currency || "AED",
        purchase_rate: body.purchase_rate ?? null,
        shipping_cost: Number(body.shipping_cost || 0),
        customs_cost: Number(body.customs_cost || 0),
        inspection_cost: Number(body.inspection_cost || 0),
        recovery_cost: Number(body.recovery_cost || 0),
        maintenance_cost: Number(body.maintenance_cost || 0),
        other_expenses: Number(body.other_expenses || 0),
        supplier_id: body.supplier_id || null,
        supplier_name: body.supplier_name || null,
        internal_notes: body.internal_notes || null,
        completed_by: auth.user.id,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id" }
    );
    if (costErr) return NextResponse.json({ error: costErr.message }, { status: 400 });

    const { error: dealErr } = await admin
      .from("deals")
      .update({ pending_completion: false })
      .eq("id", id);
    if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
