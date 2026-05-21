import { supabase } from "@/lib/supabase";

export type ActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "paid"
  | "approved"
  | "calibrated";

export type ActivityEntity =
  | "deal"
  | "car"
  | "movement"
  | "container"
  | "client"
  | "conversion"
  | "cash_exchange"
  | "rent"
  | "salary"
  | "payment"
  | "employee"
  | "debt"
  | "debt_payment"
  | "cash_position";

export interface LogActivityParams {
  action: ActivityAction;
  entity: ActivityEntity;
  entity_id?: string | null;
  description: string;
  amount?: number | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
  /** When set, used instead of the name resolved from the current session profile. */
  actorName?: string | null;
}

export async function logActivity(
  params: LogActivityParams
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { action, entity, entity_id, description, amount, currency, actorName: actorNameParam } = params;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let actorName: string | null = null;
  let actorUserId: string | null = user?.id ?? null;
  if (user?.id) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();
    actorName =
      (profile as { name?: string | null } | null)?.name?.trim() ||
      (user.user_metadata as { name?: string } | null)?.name?.trim() ||
      user.email ||
      null;
  }

  const resolvedActorName = actorNameParam?.trim() || actorName;

  const { error } = await supabase.from("activity_log").insert({
    action,
    entity,
    entity_id: entity_id ?? null,
    description,
    amount: amount ?? null,
    currency: currency ?? null,
    actor_user_id: actorUserId,
    actor_name: resolvedActorName,
  });

  if (error) {
    return { ok: false, error: error.message || "Failed to write activity log." };
  }
  return { ok: true };
}
