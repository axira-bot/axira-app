import type { User } from "@supabase/supabase-js";

function trimRole(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

/**
 * Canonical app role: `user_profiles.role` wins, then JWT metadata, then `"staff"`.
 * Never defaults to `"owner"` (avoids elevating users when the profile row is missing or role is unset).
 */
export function resolveEffectiveRole(
  profileRole: string | null | undefined,
  user: Pick<User, "user_metadata" | "app_metadata">
): string {
  const fromProfile = trimRole(profileRole);
  const fromJwt =
    trimRole((user.user_metadata as { role?: string } | null)?.role) ??
    trimRole((user.app_metadata as { role?: string } | null)?.role);
  const raw = fromProfile ?? fromJwt ?? "staff";
  return raw.toLowerCase();
}
