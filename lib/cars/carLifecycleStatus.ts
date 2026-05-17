/** Canonical physical lifecycle on `cars.lifecycle_status` (exact DB order used in UI selects). */

export const CAR_LIFECYCLE_STATUSES = [
  "ORDERED",
  "IN_PRODUCTION",
  "READY_FOR_EXPORT",
  "AT_POL",
  "LOADED",
  "IN_TRANSIT",
  "AT_POD",
  "CLEARED",
  "DELIVERED",
] as const;

export type CarLifecycleStatus = (typeof CAR_LIFECYCLE_STATUSES)[number];

/** Customer-facing sales list tabs (excluding catalog + DELIVERED). */
export const SALES_LIST_LIFECYCLE_BUCKETS = [
  "available_now",
  "ready_for_export",
  "in_transit",
  "coming_soon",
] as const;

export type SalesListLifecycleBucket = (typeof SALES_LIST_LIFECYCLE_BUCKETS)[number];

export function isCarLifecycleStatus(s: string): s is CarLifecycleStatus {
  return (CAR_LIFECYCLE_STATUSES as readonly string[]).includes(String(s ?? "").trim());
}

/** Maps canonical `cars.lifecycle_status` → sales-list bucket; `DELIVERED` → hide from list (`null`). */
export function salesBucketFor(lifecycle_status: string | null | undefined): SalesListLifecycleBucket | null {
  const raw = String(lifecycle_status ?? "").trim();
  if (!raw || !isCarLifecycleStatus(raw)) {
    /** Invalid / empty defaults to upstream supply chain (safest visibility). */
    return "coming_soon";
  }
  switch (raw) {
    case "DELIVERED":
      return null;
    case "ORDERED":
    case "IN_PRODUCTION":
      return "coming_soon";
    case "READY_FOR_EXPORT":
    case "AT_POL":
      return "ready_for_export";
    case "LOADED":
    case "IN_TRANSIT":
      return "in_transit";
    case "AT_POD":
    case "CLEARED":
      return "available_now";
    default:
      return "coming_soon";
  }
}

/** Human-readable label for badges (fallback: Ordered). */
export function displayCarLifecycle(s: string | null | undefined): string {
  const v = String(s ?? "").trim();
  const key = isCarLifecycleStatus(v) ? v : "ORDERED";
  return key.replace(/_/g, " ");
}

/** Extra Tailwind classes for canonical lifecycle Chips (inventory list). */
export function lifecycleStatusChipTone(status: string | null | undefined): string {
  const k = String(status ?? "").trim();
  if (k === "READY_FOR_EXPORT") {
    return "border-teal-500/60 bg-teal-50 text-teal-900 shadow-none dark:border-teal-500/50 dark:bg-teal-950/35 dark:text-teal-50";
  }
  return "";
}
