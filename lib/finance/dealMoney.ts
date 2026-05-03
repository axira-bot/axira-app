export type HubCurrency = "AED" | "USD" | "DZD" | "EUR";

export type MoneyFact = {
  amount: number;
  currency: string;
  rateToAed: number | null;
};

export type DealExpenseFact = MoneyFact & { expenseType: string };

export type InvoiceDeclared = {
  amount: number | null;
  currency: string | null;
  usdCosmetic: number | null;
};

export type DealMoneyFactsInput = {
  sale: MoneyFact;
  cost: MoneyFact;
  expenses: DealExpenseFact[];
  invoiceDeclared?: InvoiceDeclared | null;
};

export type DisplayFx = {
  /** AED per 1 USD (e.g. ~3.67) */
  aedPerUsd: number;
  /** AED per 1 EUR */
  aedPerEur: number;
  /** AED per 1 DZD (multiply DZD by this to get AED) */
  aedPerDzd: number;
};

/** App settings: rate_USD / rate_DZD / rate_EUR are foreign currency per 1 AED. */
export function displayFxFromAppRates(r: {
  USD: number;
  DZD: number;
  EUR: number;
}): DisplayFx {
  return {
    aedPerUsd: r.USD > 0 ? 1 / r.USD : 0,
    aedPerEur: r.EUR > 0 ? 1 / r.EUR : 0,
    aedPerDzd: r.DZD > 0 ? 1 / r.DZD : 0,
  };
}

export function dbDealExpenseToFact(row: {
  expense_type: string;
  amount: number;
  currency: string;
  rate_to_aed: number;
}): DealExpenseFact {
  return {
    expenseType: row.expense_type,
    amount: row.amount,
    currency: row.currency,
    rateToAed: row.rate_to_aed,
  };
}

/** Legacy PO / mixed UI: DZD value is DZD per AED; USD/EUR value is AED per unit (multiply). */
export function legacyRateInputToAedPerUnit(currency: string, rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return 1;
  const c = normCurrency(currency);
  if (c === "AED") return 1;
  if (c === "DZD") return 1 / rate;
  return rate;
}

function normCurrency(currency: string): string {
  return String(currency || "").trim().toUpperCase();
}

/**
 * AED per 1 unit of `currency` (multiply `amount` to get AED).
 * Matches inventory convention: non-AED purchase uses purchase_rate as AED multiplier.
 */
export function toAed(amount: number, currency: string, rateToAed: number | null | undefined): number {
  const c = normCurrency(currency);
  if (!Number.isFinite(amount)) return 0;
  if (c === "AED") return amount;
  if (rateToAed == null || !Number.isFinite(rateToAed) || rateToAed <= 0) return 0;
  return amount * rateToAed;
}

export function computeDealCore(facts: DealMoneyFactsInput) {
  const saleAed = toAed(facts.sale.amount, facts.sale.currency, facts.sale.rateToAed);
  const costAed = toAed(facts.cost.amount, facts.cost.currency, facts.cost.rateToAed);
  const expensesAedByRow = facts.expenses.map((e) => ({
    expenseType: e.expenseType,
    aed: toAed(e.amount, e.currency, e.rateToAed),
  }));
  const expensesAedTotal = expensesAedByRow.reduce((s, r) => s + r.aed, 0);
  const profitAed = saleAed - costAed - expensesAedTotal;
  return { saleAed, costAed, expensesAedByRow, expensesAedTotal, profitAed };
}

/** Display-only: convert AED amount to another currency using today's rates. */
export function aedToCurrency(aed: number, target: string, fx: DisplayFx): number {
  const t = normCurrency(target);
  if (!Number.isFinite(aed)) return 0;
  switch (t) {
    case "AED":
      return aed;
    case "USD":
      return fx.aedPerUsd > 0 ? aed / fx.aedPerUsd : 0;
    case "EUR":
      return fx.aedPerEur > 0 ? aed / fx.aedPerEur : 0;
    case "DZD":
      return fx.aedPerDzd > 0 ? aed / fx.aedPerDzd : 0;
    default:
      return aed;
  }
}

export function computeDealPresentation(core: ReturnType<typeof computeDealCore>, fx: DisplayFx) {
  return {
    profitUsd: aedToCurrency(core.profitAed, "USD", fx),
    profitDzd: aedToCurrency(core.profitAed, "DZD", fx),
    profitEur: aedToCurrency(core.profitAed, "EUR", fx),
    saleUsd: aedToCurrency(core.saleAed, "USD", fx),
    saleDzd: aedToCurrency(core.saleAed, "DZD", fx),
    costUsd: aedToCurrency(core.costAed, "USD", fx),
    expensesUsd: aedToCurrency(core.expensesAedTotal, "USD", fx),
  };
}

/** DZD list price + DZD-per-AED rate at deal time → AED per 1 DZD snapshot */
export function saleDzdRateToAedFromDzdPerAed(dzdPerAed: number): number | null {
  if (!Number.isFinite(dzdPerAed) || dzdPerAed <= 0) return null;
  return 1 / dzdPerAed;
}

export function mergeDealWithDerived<
  T extends {
    sale_amount: number;
    sale_currency: string;
    sale_rate_to_aed: number | null;
    cost_amount: number;
    cost_currency: string;
    cost_rate_to_aed: number;
  },
>(
  row: T,
  expenses: DealExpenseFact[],
  fxToday: DisplayFx
): T & {
  derived: ReturnType<typeof computeDealCore> & ReturnType<typeof computeDealPresentation>;
} {
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
  const presentation = computeDealPresentation(core, fxToday);
  return {
    ...row,
    derived: { ...core, ...presentation },
  };
}
