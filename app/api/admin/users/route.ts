import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/auth/featureKeys";

export const dynamic = "force-dynamic";

function isOwnerLikeRole(role: string | null | undefined): boolean {
  const normalized = (role || "").toLowerCase();
  return normalized === "owner" || normalized === "super_admin" || normalized === "admin";
}

type UserProfile = {
  id: string;
  name: string | null;
  role: string | null;
  employee_id: string | null;
  investor_id: string | null;
  created_at: string | null;
};

type PatchBody =
  | {
      intent: "reset_password";
      user_id: string;
      new_password: string;
    }
  | {
      intent: "update_profile_role_links";
      user_id: string;
      role?: string | null;
      name?: string | null;
      employee_id?: string | null;
      investor_id?: string | null;
    }
  | {
      intent: "set_feature_permissions";
      user_id: string;
      permissions: Partial<Record<FeatureKey, boolean>>;
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
    .maybeSingle();
  const profileRole = (profile as { role?: string } | null)?.role ?? null;
  const metadataRole =
    (user.user_metadata as { role?: string } | null)?.role ??
    (user.app_metadata as { role?: string } | null)?.role ??
    null;
  const effectiveRole = (profileRole || metadataRole || "").toLowerCase();
  if (!isOwnerLikeRole(effectiveRole)) {
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
    const permissionsRes = await admin
      .from("user_feature_permissions")
      .select("user_id, feature_key, allowed");
    const permissionMap = new Map<string, Partial<Record<FeatureKey, boolean>>>();
    (
      (permissionsRes.data as
        | { user_id?: string | null; feature_key?: string | null; allowed?: boolean | null }[]
        | null) ?? []
    ).forEach((r) => {
      const userId = r.user_id || "";
      const key = (r.feature_key || "") as FeatureKey;
      if (!userId || !FEATURE_KEYS.includes(key)) return;
      const existing = permissionMap.get(userId) || {};
      existing[key] = Boolean(r.allowed);
      permissionMap.set(userId, existing);
    });
    (users ?? []).forEach((u) => {
      const metadataPerms =
        (u.app_metadata as { feature_permissions?: Record<string, boolean> } | null)
          ?.feature_permissions ?? {};
      const existing = permissionMap.get(u.id) || {};
      (Object.entries(metadataPerms) as [FeatureKey, boolean][]).forEach(([key, allowed]) => {
        if (FEATURE_KEYS.includes(key)) existing[key] = Boolean(allowed);
      });
      permissionMap.set(u.id, existing);
    });

    const list = (users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? "",
      name: profileMap.get(u.id)?.name ?? null,
      role: profileMap.get(u.id)?.role ?? "staff",
      employee_id: profileMap.get(u.id)?.employee_id ?? null,
      investor_id: profileMap.get(u.id)?.investor_id ?? null,
      permissions: permissionMap.get(u.id) || {},
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
    // Delete auth user first; if this fails for reasons other than "not found",
    // keep profile untouched to preserve consistency.
    const hardDelete = await admin.auth.admin.deleteUser(id);
    let deleteAuthError = hardDelete.error;
    // Supabase can return "Database error deleting user" for hard delete in some projects.
    // Fallback to soft-delete to reliably disable/remove access.
    if (deleteAuthError && /database error deleting user/i.test(deleteAuthError.message || "")) {
      const softDelete = await admin.auth.admin.deleteUser(id, true);
      deleteAuthError = softDelete.error;
    }
    const authDeleteFailed =
      deleteAuthError &&
      !/not found|no rows|does not exist|user.*not.*found/i.test(
        deleteAuthError.message || ""
      );
    if (authDeleteFailed) {
      return NextResponse.json(
        { error: `Failed to delete auth user: ${deleteAuthError?.message || "Unknown error"}` },
        { status: 400 }
      );
    }

    const { error: deleteProfileError } = await admin
      .from("user_profiles")
      .delete()
      .eq("id", id);

    const profileDeleteFailed =
      deleteProfileError &&
      !/no rows|not found|does not exist/i.test(deleteProfileError.message || "");
    if (profileDeleteFailed) {
      return NextResponse.json(
        {
          error: `Auth user deleted, but failed to delete profile: ${deleteProfileError.message}. Please clean up user_profiles manually.`,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      auth_deleted: !deleteAuthError,
      profile_deleted: !deleteProfileError,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await ensureOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as PatchBody;
    const admin = createAdminClient();

    if (!body?.intent) {
      return NextResponse.json({ error: "Intent is required" }, { status: 400 });
    }

    if (body.intent === "reset_password") {
      if (!body.user_id || !body.new_password || body.new_password.length < 6) {
        return NextResponse.json(
          { error: "user_id and new_password (min 6 chars) are required" },
          { status: 400 }
        );
      }
      const { error } = await admin.auth.admin.updateUserById(body.user_id, {
        password: body.new_password,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (body.intent === "update_profile_role_links") {
      if (!body.user_id) {
        return NextResponse.json({ error: "user_id is required" }, { status: 400 });
      }
      const validRoles = ["owner", "manager", "staff", "investor", "accountant"];
      const role =
        typeof body.role === "string" && validRoles.includes(body.role) ? body.role : undefined;
      const payload: Record<string, unknown> = {};
      if (typeof body.name === "string") payload.name = body.name.trim() || null;
      if (role) payload.role = role;
      if ("employee_id" in body) payload.employee_id = body.employee_id || null;
      if ("investor_id" in body) payload.investor_id = body.investor_id || null;

      const { error } = await admin.from("user_profiles").update(payload).eq("id", body.user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (body.intent === "set_feature_permissions") {
      if (!body.user_id || !body.permissions || typeof body.permissions !== "object") {
        return NextResponse.json(
          { error: "user_id and permissions are required" },
          { status: 400 }
        );
      }

      const entries = Object.entries(body.permissions)
        .filter(([feature]) => FEATURE_KEYS.includes(feature as FeatureKey))
        .map(([feature, allowed]) => ({
          user_id: body.user_id,
          feature_key: feature,
          allowed: Boolean(allowed),
        }));

      if (entries.length === 0) {
        return NextResponse.json({ ok: true, skipped: true });
      }

      const { error } = await admin
        .from("user_feature_permissions")
        .upsert(entries, { onConflict: "user_id,feature_key" });
      if (error) {
        const { data: userData, error: userError } = await admin.auth.admin.getUserById(body.user_id);
        if (userError) return NextResponse.json({ error: error.message }, { status: 400 });
        const currentMeta =
          (userData.user?.app_metadata as { [k: string]: unknown; feature_permissions?: Record<string, boolean> } | null) ?? {};
        const merged: Record<string, boolean> = {
          ...(currentMeta.feature_permissions ?? {}),
        };
        entries.forEach((entry) => {
          merged[entry.feature_key] = Boolean(entry.allowed);
        });
        const { error: metaUpdateError } = await admin.auth.admin.updateUserById(body.user_id, {
          app_metadata: {
            ...currentMeta,
            feature_permissions: merged,
          },
        });
        if (metaUpdateError) return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported intent" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
