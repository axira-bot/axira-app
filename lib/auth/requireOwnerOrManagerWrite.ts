import { createClient as createServerClient } from "@/lib/supabase/server";
import { normalizeRole } from "@/lib/auth/roles";

/** Owner-like (owner / admin / super_admin) or manager — same write surface as PO items. */
export async function requireOwnerOrManagerWrite() {
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
  const role = normalizeRole(
    (profile as { role?: string } | null)?.role ??
      (user.app_metadata as { role?: string } | null)?.role ??
      "staff"
  );
  const canWrite =
    role === "owner" || role === "admin" || role === "super_admin" || role === "manager";
  if (!canWrite) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, user };
}
