import type { SupabaseClient } from "@supabase/supabase-js";

export type CarAuditField =
  | "vin"
  | "lifecycle_status"
  | "inventory_lifecycle_status"
  | "status"
  | "display_status"
  | "status_override"
  | string;

export interface LogCarChangeParams {
  carId: string;
  fieldName: CarAuditField;
  oldValue: string | null;
  newValue: string;
  changedBy: string | null;
  reason?: string | null;
}

/**
 * Low-level helper to append a row into car_audit_log.
 * Call this from server-side routes using an admin Supabase client,
 * ideally inside the same transaction as the car update.
 */
export async function logCarChange(
  admin: SupabaseClient,
  params: LogCarChangeParams
): Promise<void> {
  const payload = {
    car_id: params.carId,
    field_name: params.fieldName,
    old_value: params.oldValue,
    new_value: params.newValue,
    changed_by: params.changedBy,
    reason: params.reason ?? null,
  };

  const { error } = await admin.from("car_audit_log").insert(payload);
  if (error) {
    // Surface a clear error so callers can decide whether to fail the whole request.
    throw new Error(error.message);
  }
}

