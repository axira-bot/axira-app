import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

console.log("Service key exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("All env keys:", Object.keys(process.env).filter((k) => k.includes("SUPABASE")));

export const dynamic = "force-dynamic";

type UserProfile = {
  id: string;
  name: string | null;
  role: string | null;
  employee_id: string | null;
  investor_id: string | null;
  created_at: string | null;
};

async function ensureOwner() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized", status: 401 as const };
  }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if ((profile as { role?: string } | null)?.role !== "owner") {
    return { error: "Forbidden: owner only", status: 403 as const };
  }
  return { user };
}

export async function GET() {
  const auth = await ensureOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const admin = createAdminClient();
    const {
      data: { users },
      error: listError,
    } = await admin.auth.admin.listUsers({ perPage: 500 });
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("id, name, role, employee_id, investor_id, created_at");
    const profileMap = new Map<string, UserProfile>();
    (profiles as UserProfile[] | null)?.forEach((p) => profileMap.set(p.id, p));
    const list = (users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? "",
      name: profileMap.get(u.id)?.name ?? null,
      role: profileMap.get(u.id)?.role ?? "staff",
      created_at: profileMap.get(u.id)?.created_at ?? u.created_at,
    }));
    return NextResponse.json(list);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await ensureOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const body = await request.json();
    const { email, name, role, password, employee_id, investor_id } = body as {
      email?: string;
      name?: string;
      role?: string;
      password?: string;
      employee_id?: string | null;
      investor_id?: string | null;
    };
    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const fullName = name && typeof name === "string" ? name.trim() : "";
    if (!fullName) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    }
    const validRoles = ["owner", "manager", "staff", "investor", "accountant"];
    const safeRole = role && validRoles.includes(role) ? role : "staff";
    const tempPassword =
      typeof password === "string" && password.length >= 6
        ? password
        : undefined;
    const admin = createAdminClient();
    const {
      data: { user },
      error: createError,
    } = await admin.auth.admin.createUser({
      email: email.trim(),
      password: tempPassword ?? undefined,
      email_confirm: true,
    });
    if (createError) {
      return NextResponse.json(
        { error: createError.message },
        { status: 400 }
      );
    }
    if (!user) {
      return NextResponse.json({ error: "User not created" }, { status: 500 });
    }
    await admin.from("user_profiles").insert({
      id: user.id,
      name: fullName || null,
      role: safeRole,
      employee_id: employee_id && typeof employee_id === "string" ? employee_id : null,
      investor_id: investor_id && typeof investor_id === "string" ? investor_id : null,
    });
    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: fullName || null,
      role: safeRole,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await ensureOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "User id required" }, { status: 400 });
  }
  if (id === auth.user.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 400 }
    );
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
