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

  await supabase.from("activity_log").insert({
    action,
    entity,
    entity_id: entity_id ?? null,
    description,
    amount: amount ?? null,
    currency: currency ?? null,
    actor_user_id: actorUserId,
    actor_name: actorName,
  });
}
