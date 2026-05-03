import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDealCore, dbDealExpenseToFact } from "./dealMoney";

export type DealCoreInputRow = {
  id: string;
  sale_amount: number;
  sale_currency: string;
  sale_rate_to_aed: number | null;
  cost_amount: number;
  cost_currency: string;
  cost_rate_to_aed: number;
};

export async function attachDealCoreMetrics<T extends DealCoreInputRow>(
  supabase: SupabaseClient,
  rows: T[]
): Promise<
  (T & {
    profit_aed: number;
    sale_aed_derived: number;
    expenses_aed_total: number;
    cost_aed: number;
  })[]
> {
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const { data: exData, error } = await supabase
    .from("deal_expenses")
    .select("deal_id, expense_type, amount, currency, rate_to_aed")
    .in("deal_id", ids);

  const byDeal: Record<
    string,
    { expense_type: string; amount: number; currency: string; rate_to_aed: number }[]
  > = {};

  if (!error) {
    for (const r of exData ?? []) {
      const row = r as {
        deal_id: string;
        expense_type: string;
        amount: number;
        currency: string;
        rate_to_aed: number;
      };
      if (!byDeal[row.deal_id]) byDeal[row.deal_id] = [];
      byDeal[row.deal_id].push(row);
    }
  }

  return rows.map((row) => {
    const expenses = (byDeal[row.id] ?? []).map(dbDealExpenseToFact);
    const core = computeDealCore({
      sale: {
        amount: row.sale_amount,
        currency: row.sale_currency,
        rateToAed: row.sale_rate_to_aed,
      },
      cost: {
        amount: row.cost_amount,
        currency: row.cost_currency,
        rateToAed: row.cost_rate_to_aed,
      },
      expenses,
    });
    return {
      ...row,
      profit_aed: core.profitAed,
      sale_aed_derived: core.saleAed,
      expenses_aed_total: core.expensesAedTotal,
      cost_aed: core.costAed,
    };
  });
}
