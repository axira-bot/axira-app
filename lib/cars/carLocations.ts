import type { CarLifecycleStatus } from "@/lib/cars/carLifecycleStatus";

/** Single source of truth for allowed `cars.location` values (non-null). */
export const CAR_LOCATION = {
  chinaPort: "China Port",
  dubaiShowroom: "Dubai Showroom",
  axiraDzShowroom: "Axira DZ Showroom",
  inTransit: "In Transit",
} as const;

export type CarLocation = (typeof CAR_LOCATION)[keyof typeof CAR_LOCATION];

export const CAR_LOCATIONS: readonly CarLocation[] = [
  CAR_LOCATION.chinaPort,
  CAR_LOCATION.dubaiShowroom,
  CAR_LOCATION.axiraDzShowroom,
  CAR_LOCATION.inTransit,
];

export function isCarLocation(s: string | null | undefined): s is CarLocation {
  return s != null && (CAR_LOCATIONS as readonly string[]).includes(String(s).trim());
}

/**
 * Suggested physical stock location after a lifecycle transition (never auto-applied).
 * DELIVERED → no suggestion (customer has the car).
 */
export function suggestedLocationForLifecycle(status: CarLifecycleStatus): CarLocation | null {
  switch (status) {
    case "ORDERED":
    case "IN_PRODUCTION":
    case "AT_POL":
      return CAR_LOCATION.chinaPort;
    case "READY_FOR_EXPORT":
      return CAR_LOCATION.dubaiShowroom;
    case "LOADED":
    case "IN_TRANSIT":
      return CAR_LOCATION.inTransit;
    case "AT_POD":
    case "CLEARED":
      return CAR_LOCATION.axiraDzShowroom;
    case "DELIVERED":
      return null;
    default:
      return null;
  }
}
