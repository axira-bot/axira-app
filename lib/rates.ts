import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRates = {
  DZD: number;
  EUR: number;
  USD: number;
  GBP: number;
};

export async function getRates(): Promise<AppRates> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["rate_DZD", "rate_EUR", "rate_USD", "rate_GBP"]);

  if (error || !data) {
    return { DZD: 0, EUR: 0, USD: 0, GBP: 0 };
  }

  const map = new Map<string, number>();
  for (const row of data as { key: string; value: string | null }[]) {
    const num = Number(row.value ?? "0");
    map.set(row.key, Number.isFinite(num) ? num : 0);
  }

  return {
    DZD: map.get("rate_DZD") ?? 0,
    EUR: map.get("rate_EUR") ?? 0,
    USD: map.get("rate_USD") ?? 0,
    GBP: map.get("rate_GBP") ?? 0,
  };
}

/** Load dashboard FX keys (works with browser client or service-role admin client). */
export async function fetchAppRatesFromSettingsTable(client: SupabaseClient): Promise<AppRates> {
  const { data, error } = await client
    .from("app_settings")
    .select("key, value")
    .in("key", ["rate_DZD", "rate_EUR", "rate_USD", "rate_GBP"]);
  if (error || !data) {
    return { DZD: 0, EUR: 0, USD: 0, GBP: 0 };
  }
  const map = new Map<string, number>();
  for (const row of data as { key: string; value: string | null }[]) {
    const num = Number(row.value ?? "0");
    map.set(row.key, Number.isFinite(num) ? num : 0);
  }
  return {
    DZD: map.get("rate_DZD") ?? 0,
    EUR: map.get("rate_EUR") ?? 0,
    USD: map.get("rate_USD") ?? 0,
    GBP: map.get("rate_GBP") ?? 0,
  };
}

