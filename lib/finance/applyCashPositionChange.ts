import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mirrors client-side movements `updateCashPosition`: applies signed delta to cash_positions
 * for the pocket/currency row (insert row if missing).
 * `type` is movement type: "In" adds funds, "Out" subtracts.
 */
export async function applyMovementToCashPosition(
  db: SupabaseClient,
  params: { pocket: string; currency: string; amount: number; type: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pocket = params.pocket?.trim();
  const currency = (params.currency || "").trim();
  const amount = Number(params.amount || 0);
  if (!pocket || !currency || amount <= 0) {
    return { ok: false, error: "Invalid pocket, currency, or amount for cash position update." };
  }
  const isIn = (params.type || "").toLowerCase() === "in";
  const signed = isIn ? amount : -amount;

  const { data: rows, error } = await db
    .from("cash_positions")
    .select("id, amount")
    .eq("pocket", pocket)
    .eq("currency", currency)
    .limit(1);

  if (error) {
    return { ok: false, error: error.message || "Failed to read cash_positions." };
  }

  const row = rows?.[0] as { id: string; amount: number | null } | undefined;

  if (!row) {
    const { error: insertError } = await db.from("cash_positions").insert({
      pocket,
      currency,
      amount: signed,
    });
    if (insertError) {
      return { ok: false, error: insertError.message || "Failed to create cash_positions row." };
    }
    return { ok: true };
  }

  const currentAmount = row.amount ?? 0;
  const newAmount = currentAmount + signed;
  const { error: updateError } = await db.from("cash_positions").update({ amount: newAmount }).eq("id", row.id);
  if (updateError) {
    return { ok: false, error: updateError.message || "Failed to update cash_positions." };
  }
  return { ok: true };
}

/** Reverse effect of an Out movement (credit pocket); reverse of In debits. */
export async function reverseMovementOnCashPosition(
  db: SupabaseClient,
  movement: { pocket: string | null; currency: string | null; amount: number | null; type: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pocket = movement.pocket?.trim() || "";
  const currency = (movement.currency || "").trim();
  const amount = Number(movement.amount || 0);
  if (!pocket || !currency || amount <= 0) return { ok: true };

  const { data: rows, error } = await db
    .from("cash_positions")
    .select("id")
    .eq("pocket", pocket)
    .eq("currency", currency)
    .limit(1);

  if (error) {
    return { ok: false, error: error.message || "Failed to read cash_positions." };
  }

  // Approval may have skipped cash when no row existed for this pocket+currency — nothing to reverse.
  if (!rows?.[0]) {
    return { ok: true };
  }

  const t = (movement.type || "").toLowerCase();
  const reversedType = t === "in" ? "Out" : "In";
  return applyMovementToCashPosition(db, { pocket, currency, amount, type: reversedType });
}
