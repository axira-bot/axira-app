import { describe, expect, it } from "vitest";
import {
  computeDealCore,
  displayFxFromAppRates,
  saleDzdRateToAedFromDzdPerAed,
  toAed,
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
