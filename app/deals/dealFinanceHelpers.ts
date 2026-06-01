import type { Car } from "@/lib/types";
import type { DealExpenseFact } from "@/lib/finance/dealMoney";
import {
  displayFxFromAppRates,
  saleDzdRateToAedFromDzdPerAed,
  usdPerAedFromAppUsdSetting,
} from "@/lib/finance/dealMoney";

export type DealExpenseRow = {
  id?: string;
  deal_id?: string;
  expense_type: string;
  amount: number;
  currency: string;
  rate_to_aed: number;
};

/** USD/EUR: normally AED per 1 foreign unit (~3.x). Values ~0.2–0.35 are usually foreign-per-AED — invert. */
export function normalizeUsdEurRateToAedPerUnit(currency: string, raw: number): number {
  const c = currency.toUpperCase();
  if (!(c === "USD" || c === "EUR") || !(raw > 0)) return raw;
  if (raw < 0.45) return 1 / raw;
  return raw;
}

const USD_EUR_RATE_MIN = 0.1;
const USD_EUR_RATE_MAX = 50;
const DZD_RATE_MIN = 0.001;
const DZD_RATE_MAX = 1;

/** Matches DB CHECK constraints on deals / deal_expenses rate_to_aed columns. */
export function isPlausibleRateToAed(currency: string, rateToAed: number): boolean {
  const c = currency.toUpperCase();
  if (!Number.isFinite(rateToAed) || rateToAed <= 0) return false;
  if (c === "AED") return rateToAed === 1;
  if (c === "USD" || c === "EUR") return rateToAed >= USD_EUR_RATE_MIN && rateToAed <= USD_EUR_RATE_MAX;
  if (c === "DZD") return rateToAed >= DZD_RATE_MIN && rateToAed <= DZD_RATE_MAX;
  return true;
}

export function assertPlausibleRateToAed(currency: string, rateToAed: number, label = "rate"): void {
  if (isPlausibleRateToAed(currency, rateToAed)) return;
  const c = currency.toUpperCase();
  if (c === "AED") {
    throw new Error(`${label}: AED cost must use rate 1.`);
  }
  if (c === "USD" || c === "EUR") {
    throw new Error(
      `${label}: for ${c}, enter AED per 1 ${c} (typically 0.1–50, e.g. ~3.67). Values like 67 or 250 are DZD-scale and are not allowed.`
    );
  }
  if (c === "DZD") {
    throw new Error(`${label}: for DZD, rate must be AED per 1 DZD (typically 0.001–1).`);
  }
  throw new Error(`${label}: invalid rate for ${currency}.`);
}

type AppRatesSlice = { USD: number; DZD: number; EUR: number };

/**
 * Snapshot for deal cost: amount + currency + rate_to_aed (AED per 1 unit; multiply to get AED).
 * - DZD: entered rate is DZD per 1 AED → rateToAed = 1 / rate.
 * - USD/EUR: entered rate is AED per 1 unit (normalized); implausibly large values may be inverted once.
 * - Missing rate: optional `appRates` dashboard snapshot.
 */
export function enteredPurchaseCostToCostFact(
  params: { amount: number; currency: string; purchaseRate?: number | null },
  appRates?: AppRatesSlice
): { amount: number; currency: string; rateToAed: number } {
  const currency = (String(params.currency ?? "").trim() || "AED").toUpperCase();
  const amount = params.amount ?? 0;
  if (currency === "AED") return { amount, currency: "AED", rateToAed: 1 };

  const fx = appRates ? displayFxFromAppRates(appRates) : null;
  const rawPr = params.purchaseRate;

  if (currency === "DZD") {
    const dzdPerAed =
      rawPr != null && rawPr > 0
        ? rawPr
        : fx && appRates && appRates.DZD > 0
          ? appRates.DZD
          : 0;
    const rateToAed = dzdPerAed > 0 ? 1 / dzdPerAed : 0.0000001;
    return { amount, currency: "DZD", rateToAed };
  }

  let rateToAed: number;
  if (rawPr == null || !(rawPr > 0)) {
    if (currency === "USD" && fx && fx.aedPerUsd > 0) rateToAed = fx.aedPerUsd;
    else if (currency === "EUR" && fx && fx.aedPerEur > 0) rateToAed = fx.aedPerEur;
    else rateToAed = 0.0000001;
  } else {
    rateToAed = normalizeUsdEurRateToAedPerUnit(currency, rawPr);
    if ((currency === "USD" || currency === "EUR") && rateToAed > USD_EUR_RATE_MAX) {
      const inverted = normalizeUsdEurRateToAedPerUnit(currency, 1 / rawPr);
      if (inverted >= USD_EUR_RATE_MIN && inverted <= USD_EUR_RATE_MAX) {
        rateToAed = inverted;
      }
    }
  }
  return { amount, currency, rateToAed };
}

/**
 * Stock / inventory cars — delegates to {@link enteredPurchaseCostToCostFact}.
 */
export function carPurchaseToCostFact(
  car: Car | null,
  appRates?: AppRatesSlice
): {
  amount: number;
  currency: string;
  rateToAed: number;
} {
  if (!car) return { amount: 0, currency: "AED", rateToAed: 1 };
  return enteredPurchaseCostToCostFact(
    {
      amount: car.purchase_price ?? 0,
      currency: car.purchase_currency ?? "AED",
      purchaseRate: car.purchase_rate,
    },
    appRates
  );
}

export function parseNumLocal(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

export function formLinesToExpenseFacts(
  form: {
    shippingAed: string;
    shippingUsd: string;
    inspectionAed: string;
    recoveryAed: string;
    maintenanceAed: string;
    otherAed: string;
  },
  opts?: { usdExpenseRateToAed: number }
): DealExpenseFact[] {
  const rows: DealExpenseFact[] = [];
  const add = (expenseType: string, amount: number, currency: string, rateToAed: number) => {
    if (amount > 0) rows.push({ expenseType, amount, currency, rateToAed });
  };
  const usdR = opts?.usdExpenseRateToAed;
  const shipUsd = parseNumLocal(form.shippingUsd);
  if (shipUsd > 0 && usdR != null && usdR > 0) {
    add("shipping", shipUsd, "USD", usdR);
  } else {
    add("shipping", parseNumLocal(form.shippingAed), "AED", 1);
  }
  add("inspection", parseNumLocal(form.inspectionAed), "AED", 1);
  add("recovery", parseNumLocal(form.recoveryAed), "AED", 1);
  add("maintenance", parseNumLocal(form.maintenanceAed), "AED", 1);
  add("other", parseNumLocal(form.otherAed), "AED", 1);
  return rows;
}

export function expensesByTypeToFormFields(rows: DealExpenseRow[]) {
  const shipRows = rows.filter((e) => e.expense_type === "shipping");
  let shippingAed = "";
  let shippingUsd = "";
  for (const e of shipRows) {
    const c = (e.currency || "AED").toUpperCase();
    if (c === "USD") shippingUsd = String(e.amount || "");
    else if (c === "AED") shippingAed = String(e.amount || "");
  }
  const sum = (t: string) =>
    rows.filter((e) => e.expense_type === t).reduce((s, e) => s + (e.amount || 0), 0);
  return {
    shippingAed,
    shippingUsd,
    inspectionAed: String(sum("inspection") || ""),
    recoveryAed: String(sum("recovery") || ""),
    maintenanceAed: String(sum("maintenance") || ""),
    otherAed: String(sum("other") || ""),
  };
}

export function dealListSaleDzd(d: { sale_currency?: string | null; sale_amount?: number | null }): number {
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

/**
 * When `sale_rate_to_aed` was never stored (common after financial migration if legacy `sale_aed` was empty),
 * derive the same snapshot shape from dashboard keys: DZD = DZD per 1 AED, USD = normalized to AED/USD.
 */
export function saleRateToAedFromAppRatesForDzdSale(appRates: AppRatesSlice): number | null {
  if (!(appRates.DZD > 0)) return null;
  const fx = displayFxFromAppRates(appRates);
  if (!(fx.aedPerUsd > 0)) return null;
  const usdPerAed = usdPerAedFromAppUsdSetting(appRates.USD);
  if (!(usdPerAed > 0)) return null;
  const dzdPerUsd = appRates.DZD * fx.aedPerUsd;
  const dzdPerAed = dzdPerUsd * usdPerAed;
  return saleDzdRateToAedFromDzdPerAed(dzdPerAed);
}

export function withDealSaleRateDashboardFallback<
  T extends {
    sale_currency?: string | null;
    sale_rate_to_aed?: number | null;
    sale_amount?: number | null;
  },
>(d: T, appRates: AppRatesSlice): T {
  if (d.sale_rate_to_aed != null && d.sale_rate_to_aed > 0) return d;
  if (String(d.sale_currency || "").toUpperCase() !== "DZD") return d;
  if (!(Number(d.sale_amount ?? 0) > 0)) return d;
  const fb = saleRateToAedFromAppRatesForDzdSale(appRates);
  if (fb == null || !(fb > 0)) return d;
  return { ...d, sale_rate_to_aed: fb };
}

export function rateFieldFromDealWithDashboardFallback(
  d: {
    sale_currency?: string | null;
    sale_rate_to_aed?: number | null;
    sale_amount?: number | null;
  },
  usdPerAed: number,
  appRates: AppRatesSlice
): string {
  const fromRow = rateFieldFromDeal(d, usdPerAed);
  if (fromRow.trim()) return fromRow;
  const inferred = saleRateToAedFromAppRatesForDzdSale(appRates);
  if (inferred == null || !(inferred > 0) || !(usdPerAed > 0)) return "";
  const dzdPerUsd = 1 / (inferred * usdPerAed);
  return String(dzdPerUsd);
}
