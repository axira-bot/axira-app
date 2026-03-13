import { supabase } from "@/lib/supabase";

export type ActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "paid"
  | "approved";

export type ActivityEntity =
  | "deal"
  | "car"
  | "movement"
  | "container"
  | "client"
  | "conversion"
  | "rent"
  | "salary"
  | "payment"
  | "employee"
  | "debt";

export interface LogActivityParams {
  action: ActivityAction;
  entity: ActivityEntity;
  entity_id?: string | null;
  description: string;
  amount?: number | null;
  currency?: string | null;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const { action, entity, entity_id, description, amount, currency } = params;
  await supabase.from("activity_log").insert({
    action,
    entity,
    entity_id: entity_id ?? null,
    description,
    amount: amount ?? null,
    currency: currency ?? null,
  });
}
