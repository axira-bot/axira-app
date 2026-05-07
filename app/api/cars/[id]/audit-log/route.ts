import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrManagerWrite } from "@/lib/auth/requireOwnerOrManagerWrite";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOwnerOrManagerWrite();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const carId = (await context.params).id.trim();
    if (!carId) return NextResponse.json({ error: "Missing car id" }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit"));
    const offsetRaw = Number(searchParams.get("offset"));
    const limit = Number.isFinite(limitRaw)
      ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
      : DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const admin = createAdminClient();
    const end = offset + limit - 1;
    const { data, error } = await admin
      .from("car_audit_log")
      .select("id, car_id, field_name, old_value, new_value, changed_by, changed_at, reason")
      .eq("car_id", carId)
      .order("changed_at", { ascending: false })
      .range(offset, end);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rows = data ?? [];
    const has_more = rows.length >= limit;

    return NextResponse.json({
      rows,
      has_more,
      limit,
      offset,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
