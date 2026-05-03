import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { normalizeRole } from "@/lib/auth/roles";
import { canUseDestructiveActions } from "@/lib/auth/roleMatrix";

export async function deletionForbiddenResponse(): Promise<NextResponse | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const effectiveRole = normalizeRole(profileRole || metadataRole);
  if (!canUseDestructiveActions(effectiveRole)) {
    return NextResponse.json({ error: "Forbidden: delete not allowed for this role" }, { status: 403 });
  }
  return null;
}
