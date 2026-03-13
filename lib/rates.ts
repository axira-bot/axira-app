import { supabase } from "@/lib/supabase";

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

