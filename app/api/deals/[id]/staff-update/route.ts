import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

type StaffUpdateBody = {
  notes?: string | null;
  collected_dzd?: number;
  pending_dzd?: number;
  status?: string;
};

async function requireStaffOrAbove() {
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
  return { ok: true as const, user, role };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffOrAbove();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await context.params;
    const body = (await request.json()) as StaffUpdateBody;
    const admin = createAdminClient();
    const { data: deal, error: dealErr } = await admin
      .from("deals")
      .select("id, created_by")
      .eq("id", id)
      .maybeSingle();
    if (dealErr || !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const privileged = ["owner", "manager", "admin", "super_admin"].includes(auth.role);
    if (!privileged && (deal as { created_by?: string | null }).created_by !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload: Record<string, unknown> = {};
    if (typeof body.notes === "string") payload.notes = body.notes;
    if (typeof body.collected_dzd === "number") payload.collected_dzd = body.collected_dzd;
    if (typeof body.pending_dzd === "number") payload.pending_dzd = body.pending_dzd;
    if (typeof body.status === "string") payload.status = body.status;

    const { error } = await admin.from("deals").update(payload).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
