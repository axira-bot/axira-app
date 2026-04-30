import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

type DealCreateBody = {
  client_id?: string | null;
  client_name?: string;
  car_id?: string;
  car_label?: string;
  date?: string;
  sale_dzd?: number;
  collected_dzd?: number;
  pending_dzd?: number;
  pocket?: string | null;
  notes?: string | null;
  agreed_delivery_date?: string | null;
  status?: string;
  pending_completion?: boolean;
};

async function requireDealsAccess() {
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

export async function GET(request: NextRequest) {
  const auth = await requireDealsAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const admin = createAdminClient();
    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    let query = admin.from("deals").select("*").order("date", { ascending: false });
    if (auth.role === "staff") {
      query = query.eq("created_by", auth.user.id);
    }
    if (q) {
      query = query.or(`client_name.ilike.%${q}%,car_label.ilike.%${q}%`);
    }
    const { data: deals, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ rows: deals ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireDealsAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as DealCreateBody;
    if (!body.car_id || !body.client_name || !body.sale_dzd) {
      return NextResponse.json(
        { error: "car_id, client_name and sale_dzd are required." },
        { status: 400 }
      );
    }

    const isPrivileged = auth.role === "owner" || auth.role === "manager" || auth.role === "admin" || auth.role === "super_admin";
    const admin = createAdminClient();
    const insertPayload = {
      client_id: body.client_id || null,
      client_name: body.client_name.trim(),
      car_id: body.car_id,
      car_label: body.car_label || "",
      date: body.date || new Date().toISOString().slice(0, 10),
      sale_dzd: Number(body.sale_dzd || 0),
      collected_dzd: Number(body.collected_dzd || 0),
      pending_dzd: Number(body.pending_dzd || 0),
      notes: body.notes || null,
      agreed_delivery_date: body.agreed_delivery_date || null,
      status: body.status || "pending",
      created_by: auth.user.id,
      pending_completion: isPrivileged ? Boolean(body.pending_completion) : true,
    };
    const { data, error } = await admin.from("deals").insert(insertPayload).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await admin
      .from("cars")
      .update({
        linked_deal_id: (data as { id: string }).id,
        client_name: body.client_name.trim(),
      })
      .eq("id", body.car_id);
    return NextResponse.json({ row: data }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
