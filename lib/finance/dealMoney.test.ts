import { describe, expect, it } from "vitest";
import {
  aedToCurrency,
  computeDealCore,
  displayFxFromAppRates,
  saleDzdRateToAedFromDzdPerAed,
  toAed,
  usdPerAedFromAppUsdSetting,
} from "./dealMoney";

describe("dealMoney", () => {
  it("toAed uses multiply for non-AED", () => {
    expect(toAed(100, "USD", 3.67)).toBe(367);
    expect(toAed(50, "AED", 9)).toBe(50);
  });

  it("saleDzdRateToAedFromDzdPerAed inverts DZD-per-AED", () => {
    const r = saleDzdRateToAedFromDzdPerAed(37.5);
    expect(r).toBeCloseTo(1 / 37.5, 6);
  });

  it("profit_aed matches USD-sourced scenario (hub AED)", () => {
    const core = computeDealCore({
      sale: { amount: 5_000_000, currency: "DZD", rateToAed: 1 / 37.5 },
      cost: { amount: 10_000, currency: "USD", rateToAed: 3.67 },
      expenses: [{ expenseType: "shipping", amount: 500, currency: "USD", rateToAed: 3.67 }],
    });
    const saleAed = (5_000_000 / 37.5) as number;
    const costAed = 10_000 * 3.67;
    const shipAed = 500 * 3.67;
    expect(core.saleAed).toBeCloseTo(saleAed, 3);
    expect(core.costAed).toBeCloseTo(costAed, 3);
    expect(core.expensesAedTotal).toBeCloseTo(shipAed, 3);
    expect(core.profitAed).toBeCloseTo(saleAed - costAed - shipAed, 3);
  });

  it("displayFx accepts rate_USD as USD-per-AED or AED-per-USD", () => {
    const usdPerAed = 0.2725;
    const aedPerUsd = 1 / usdPerAed;
    const fx1 = displayFxFromAppRates({ USD: usdPerAed, DZD: 68, EUR: 0.25 });
    const fx2 = displayFxFromAppRates({ USD: aedPerUsd, DZD: 68, EUR: 4 });
    expect(fx1.aedPerUsd).toBeCloseTo(aedPerUsd, 4);
    expect(fx2.aedPerUsd).toBeCloseTo(aedPerUsd, 4);
    expect(fx1.aedPerUsd).toBeCloseTo(fx2.aedPerUsd, 4);
  });

  it("AED → USD display uses ~7.7k USD for 28.5k AED at ~3.67 AED/USD", () => {
    const fx = displayFxFromAppRates({ USD: 3.67, DZD: 68, EUR: 0.25 });
    const usd = aedToCurrency(28_500, "USD", fx);
    expect(usd).toBeCloseTo(28_500 / 3.67, 0);
  });

  it("usdPerAedFromAppUsdSetting matches either stored convention", () => {
    const u1 = usdPerAedFromAppUsdSetting(0.2725);
    const u2 = usdPerAedFromAppUsdSetting(1 / 0.2725);
    expect(u1).toBeCloseTo(0.2725, 4);
    expect(u2).toBeCloseTo(0.2725, 4);
  });

  it("displayFx changes do not affect computeDealCore", () => {
    const core = computeDealCore({
      sale: { amount: 100, currency: "AED", rateToAed: 1 },
      cost: { amount: 60, currency: "AED", rateToAed: 1 },
      expenses: [],
    });
    const fxOld = displayFxFromAppRates({ USD: 0.27, DZD: 37.5, EUR: 0.25 });
    const fxNew = displayFxFromAppRates({ USD: 0.26, DZD: 38, EUR: 0.24 });
    expect(core.profitAed).toBe(40);
    expect(fxOld.aedPerUsd).not.toBe(fxNew.aedPerUsd);
  });
});
