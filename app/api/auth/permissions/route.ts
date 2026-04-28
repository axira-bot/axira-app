import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { resolvePermissions } from "@/lib/auth/permissions";

export async function GET() {
  try {
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

    const role =
      (profile as { role?: string } | null)?.role ??
      (user.user_metadata as { role?: string } | null)?.role ??
      (user.app_metadata as { role?: string } | null)?.role ??
      "staff";

    const metadataPermissions =
      (user.app_metadata as { feature_permissions?: Record<string, boolean> } | null)
        ?.feature_permissions ?? null;
    const permissions = await resolvePermissions(user.id, role, metadataPermissions);
    return NextResponse.json({ permissions });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
