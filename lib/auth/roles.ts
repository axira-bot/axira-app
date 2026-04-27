export function normalizeRole(role: string | null | undefined): string {
  return (role || "").trim().toLowerCase();
}

export function isOwnerLikeRole(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "super_admin" || normalized === "admin";
}

export function isManagerLikeRole(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized === "manager";
}

export function isPreorderPrivilegedRole(role: string | null | undefined): boolean {
  return isOwnerLikeRole(role) || isManagerLikeRole(role);
}
