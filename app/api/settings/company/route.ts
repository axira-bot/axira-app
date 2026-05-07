import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEffectiveRole } from "@/lib/auth/resolveUserRole";
import {
  COMPANY_REQUIRED_FIELDS,
  companySettingsMissingFields,
  type CompanySettings,
} from "@/lib/contracts/companySettings";

export const dynamic = "force-dynamic";

async function requireOwner() {
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
  const role = resolveEffectiveRole(
    (profile as { role?: string } | null)?.role ?? null,
    user
  );
  if (role !== "owner") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const, user };
}

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("company_settings")
      .select("*")
      .eq("id", "default")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const row = data as CompanySettings;
    let updatedByName: string | null = null;
    if (row.updated_by) {
      const { data: updater } = await admin
        .from("user_profiles")
        .select("name")
        .eq("id", row.updated_by)
        .maybeSingle();
      updatedByName = (updater as { name?: string | null } | null)?.name ?? null;
    }
    return NextResponse.json({
      row,
      missing_fields: companySettingsMissingFields(row),
      is_complete: companySettingsMissingFields(row).length === 0,
      updated_by_name: updatedByName,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as Partial<CompanySettings>;
    const payload = Object.fromEntries(
      COMPANY_REQUIRED_FIELDS.map((k) => [k, String(body[k] ?? "").trim()])
    ) as Record<string, string>;
    const missing = COMPANY_REQUIRED_FIELDS.filter((k) => !payload[k]);
    if (missing.length) {
      return NextResponse.json(
        { error: "All company fields are required.", field_errors: missing },
        { status: 400 }
      );
    }
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("company_settings")
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
        updated_by: auth.user.id,
      })
      .eq("id", "default")
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      row: data,
      missing_fields: [],
      is_complete: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
