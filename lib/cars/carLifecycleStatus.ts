/** Canonical physical lifecycle on `cars.lifecycle_status`. */

export const CAR_LIFECYCLE_STATUSES = [
  "ORDERED",
  "IN_PRODUCTION",
  "AT_POL",
  "LOADED",
  "IN_TRANSIT",
  "AT_POD",
  "CLEARED",
  "DELIVERED",
] as const;

export type CarLifecycleStatus = (typeof CAR_LIFECYCLE_STATUSES)[number];

export function isCarLifecycleStatus(s: string): s is CarLifecycleStatus {
  return (CAR_LIFECYCLE_STATUSES as readonly string[]).includes(String(s ?? "").trim());
}

/** Human-readable label for badges (fallback: Ordered). */
export function displayCarLifecycle(s: string | null | undefined): string {
  const v = String(s ?? "").trim();
  const key = isCarLifecycleStatus(v) ? v : "ORDERED";
  return key.replace(/_/g, " ");
}
