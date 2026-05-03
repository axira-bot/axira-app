import type { Car } from "@/lib/types";
import type { DealExpenseFact } from "@/lib/finance/dealMoney";

export type DealExpenseRow = {
  id?: string;
  deal_id?: string;
  expense_type: string;
  amount: number;
  currency: string;
  rate_to_aed: number;
};

export function carPurchaseToCostFact(car: Car | null): {
  amount: number;
  currency: string;
  rateToAed: number;
} {
  if (!car) return { amount: 0, currency: "AED", rateToAed: 1 };
  const currency = (car.purchase_currency || "AED").toUpperCase();
  if (currency === "AED") return { amount: car.purchase_price ?? 0, currency: "AED", rateToAed: 1 };
  const pr = car.purchase_rate;
  const rate = pr != null && pr > 0 ? pr : 0.0000001;
  return { amount: car.purchase_price ?? 0, currency, rateToAed: rate };
}

export function parseNumLocal(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

export function formLinesToExpenseFacts(form: {
  shippingAed: string;
  inspectionAed: string;
  recoveryAed: string;
  maintenanceAed: string;
  otherAed: string;
}): DealExpenseFact[] {
  const rows: DealExpenseFact[] = [];
  const add = (expenseType: string, amount: number) => {
    if (amount > 0) rows.push({ expenseType, amount, currency: "AED", rateToAed: 1 });
  };
  add("shipping", parseNumLocal(form.shippingAed));
  add("inspection", parseNumLocal(form.inspectionAed));
  add("recovery", parseNumLocal(form.recoveryAed));
  add("maintenance", parseNumLocal(form.maintenanceAed));
  add("other", parseNumLocal(form.otherAed));
  return rows;
}

export function expensesByTypeToFormFields(rows: DealExpenseRow[]) {
  const sum = (t: string) =>
    rows.filter((e) => e.expense_type === t).reduce((s, e) => s + (e.amount || 0), 0);
  return {
    shippingAed: String(sum("shipping") || ""),
    inspectionAed: String(sum("inspection") || ""),
    recoveryAed: String(sum("recovery") || ""),
    maintenanceAed: String(sum("maintenance") || ""),
    otherAed: String(sum("other") || ""),
  };
}

export function dealListSaleDzd(d: {
  sale_currency?: string | null;
  sale_amount?: number | null;
}): number {
  return String(d.sale_currency || "").toUpperCase() === "DZD" ? Number(d.sale_amount ?? 0) : 0;
}

export function rateFieldFromDeal(
  d: {
    sale_currency?: string | null;
    sale_rate_to_aed?: number | null;
  },
  usdPerAed: number
): string {
  if (String(d.sale_currency || "").toUpperCase() !== "DZD") return "";
  const sr = d.sale_rate_to_aed;
  if (sr == null || !(sr > 0) || !(usdPerAed > 0)) return "";
  const dzdPerUsd = 1 / (sr * usdPerAed);
  return String(dzdPerUsd);
}
