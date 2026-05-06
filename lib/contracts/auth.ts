import { createClient as createServerClient } from "@/lib/supabase/server";
import { resolveEffectiveRole } from "@/lib/auth/resolveUserRole";

export async function requireContractGenerationAccess() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  const role = resolveEffectiveRole((profile as { role?: string } | null)?.role ?? null, user);
  const allowed = ["owner", "manager", "admin", "super_admin"].includes(role);
  if (!allowed) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, user, role };
}
