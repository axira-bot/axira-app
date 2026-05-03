/**
 * Product acceptance tests for the deal financial model (facts + snapshots → AED hub).
 *
 * Spec “exact” DZD profit for TEST 2 may show 518,535 DZD (7682×67.5 with rounded sale AED);
 * the engine keeps full precision; we assert the consistent hub chain (~518,528.75 DZD).
 */
import { describe, expect, it } from "vitest";
import { computeDealCore } from "./dealMoney";

/** Acceptance test numbers from deal-financial-model spec (facts + snapshots only; no DisplayFx). */

const AED_PER_USD = 3.67;

describe("Deal financial model — acceptance TEST 1 (China, USD cost, DZD sale)", () => {
  const saleDzd = 2_550_000;
  const dzdPerUsd = 250;
  const saleAedPerDzd = AED_PER_USD / dzdPerUsd;

  const core = computeDealCore({
    sale: { amount: saleDzd, currency: "DZD", rateToAed: saleAedPerDzd },
    cost: { amount: 7_900, currency: "USD", rateToAed: AED_PER_USD },
    expenses: [{ expenseType: "shipping", amount: 1_500, currency: "USD", rateToAed: AED_PER_USD }],
  });

  it("matches sale / profit / margin in USD via AED hub", () => {
    const saleUsd = saleDzd / dzdPerUsd;
    expect(saleUsd).toBeCloseTo(10_200, 5);

    expect(core.saleAed).toBeCloseTo(saleDzd * saleAedPerDzd, 0);
    expect(core.costAed).toBeCloseTo(7_900 * AED_PER_USD, 0);
    expect(core.expensesAedTotal).toBeCloseTo(1_500 * AED_PER_USD, 0);

    const profitUsd = core.profitAed / AED_PER_USD;
    expect(profitUsd).toBeCloseTo(800, 5);
    expect(core.profitAed).toBeCloseTo(800 * AED_PER_USD, 0);

    const margin = profitUsd / saleUsd;
    expect(margin).toBeCloseTo(0.07843137, 4);
  });
});

describe("Deal financial model — acceptance TEST 2 (Dubai, AED cost, DZD sale, USD shipping)", () => {
  const dzdPerAed = 67.5;
  const saleDzd = 4_550_000;
  const saleAedPerDzd = 1 / dzdPerAed;

  const core = computeDealCore({
    sale: { amount: saleDzd, currency: "DZD", rateToAed: saleAedPerDzd },
    cost: { amount: 50_000, currency: "AED", rateToAed: 1 },
    expenses: [{ expenseType: "shipping", amount: 2_650, currency: "USD", rateToAed: AED_PER_USD }],
  });

  it("matches sale AED, shipping AED, profit AED / DZD / margin", () => {
    expect(core.saleAed).toBeCloseTo(4_550_000 / 67.5, 0);
    expect(core.costAed).toBe(50_000);
    expect(core.expensesAedTotal).toBeCloseTo(2_650 * AED_PER_USD, 0);

    expect(core.profitAed).toBeCloseTo(4_550_000 / dzdPerAed - 50_000 - 2_650 * AED_PER_USD, 4);
    const profitDzdAtDealRate = core.profitAed * dzdPerAed;
    expect(profitDzdAtDealRate).toBeCloseTo(518_528.75, 1);

    const margin = core.profitAed / core.saleAed;
    expect(margin).toBeCloseTo(7681.907407 / (4_550_000 / 67.5), 3);
  });
});

describe("Deal financial model — invariants", () => {
  it("new expense updates profit immediately in memory (no persist)", () => {
    const base = computeDealCore({
      sale: { amount: 1_000_000, currency: "DZD", rateToAed: 1 / 68 },
      cost: { amount: 10_000, currency: "USD", rateToAed: 3.67 },
      expenses: [],
    });
    const withShip = computeDealCore({
      sale: { amount: 1_000_000, currency: "DZD", rateToAed: 1 / 68 },
      cost: { amount: 10_000, currency: "USD", rateToAed: 3.67 },
      expenses: [{ expenseType: "shipping", amount: 100, currency: "USD", rateToAed: 3.67 }],
    });
    expect(withShip.profitAed).toBeCloseTo(base.profitAed - 100 * 3.67, 5);
  });

  it("computeDealCore ignores display FX (tomorrow's dashboard cannot change stored facts)", () => {
    const core = computeDealCore({
      sale: { amount: 100, currency: "AED", rateToAed: 1 },
      cost: { amount: 40, currency: "AED", rateToAed: 1 },
      expenses: [{ expenseType: "other", amount: 10, currency: "AED", rateToAed: 1 }],
    });
    expect(core.profitAed).toBe(50);
  });

  it("invoice_declared is not part of computeDealCore facts", () => {
    const core = computeDealCore({
      sale: { amount: 1, currency: "AED", rateToAed: 1 },
      cost: { amount: 0, currency: "AED", rateToAed: 1 },
      expenses: [],
      invoiceDeclared: { amount: 99_999, currency: "USD", usdCosmetic: 99_999 },
    });
    expect(core.profitAed).toBe(1);
  });
});
