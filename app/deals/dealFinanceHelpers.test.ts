import { describe, expect, it } from "vitest";
import type { Car } from "@/lib/types";
import {
  carPurchaseToCostFact,
  formLinesToExpenseFacts,
  rateFieldFromDeal,
  rateFieldFromDealWithDashboardFallback,
  saleRateToAedFromAppRatesForDzdSale,
} from "@/app/deals/dealFinanceHelpers";

describe("formLinesToExpenseFacts", () => {
  it("records USD shipping with AED snapshot when USD amount set", () => {
    const facts = formLinesToExpenseFacts(
      {
        shippingAed: "",
        shippingUsd: "1500",
        inspectionAed: "",
        recoveryAed: "",
        maintenanceAed: "",
        otherAed: "",
      },
      { usdExpenseRateToAed: 3.67 }
    );
    expect(facts.find((f) => f.expenseType === "shipping")).toMatchObject({
      amount: 1500,
      currency: "USD",
      rateToAed: 3.67,
    });
  });

  it("uses AED shipping when USD shipping empty", () => {
    const facts = formLinesToExpenseFacts(
      {
        shippingAed: "200",
        shippingUsd: "",
        inspectionAed: "",
        recoveryAed: "",
        maintenanceAed: "",
        otherAed: "",
      },
      { usdExpenseRateToAed: 3.67 }
    );
    expect(facts.find((f) => f.expenseType === "shipping")).toMatchObject({
      amount: 200,
      currency: "AED",
      rateToAed: 1,
    });
  });
});

describe("saleRateToAedFromAppRatesForDzdSale", () => {
  it("matches DZD-per-USD composed from dashboard keys", () => {
    const dash = { USD: 3.67, DZD: 50, EUR: 4 };
    const sr = saleRateToAedFromAppRatesForDzdSale(dash);
    expect(sr).not.toBeNull();
    const usdPerAed = 1 / 3.67;
    const dzdPerUsd = 50 * 3.67;
    const dzdPerAed = dzdPerUsd * usdPerAed;
    expect(sr).toBeCloseTo(1 / dzdPerAed, 8);
  });
});

describe("rateFieldFromDealWithDashboardFallback", () => {
  it("uses stored sale_rate_to_aed when present", () => {
    const usdPerAed = 1 / 3.67;
    const dzdPerUsd = 135;
    const sale_rate_to_aed = 1 / (dzdPerUsd * usdPerAed);
    const row = { sale_currency: "DZD", sale_rate_to_aed, sale_amount: 1e6 };
    const dash = { USD: 3.67, DZD: 999, EUR: 4 };
    const direct = rateFieldFromDeal(row, usdPerAed);
    const withFb = rateFieldFromDealWithDashboardFallback(row, usdPerAed, dash);
    expect(direct).toBe(String(dzdPerUsd));
    expect(withFb).toBe(direct);
  });

  it("falls back to dashboard when sale_rate_to_aed missing", () => {
    const usdPerAed = 1 / 3.67;
    const dash = { USD: 3.67, DZD: 50, EUR: 4 };
    const inferred = saleRateToAedFromAppRatesForDzdSale(dash);
    expect(inferred).not.toBeNull();
    const expectDzdPerUsd = 1 / (inferred! * usdPerAed);
    const withFb = rateFieldFromDealWithDashboardFallback(
      { sale_currency: "DZD", sale_rate_to_aed: null, sale_amount: 1 },
      usdPerAed,
      dash
    );
    expect(Number(withFb)).toBeCloseTo(expectDzdPerUsd, 6);
  });
});

const baseCar = (over: Partial<Car>): Car =>
  ({
    id: "x",
    brand: "B",
    model: "M",
    year: 2024,
    color: "c",
    mileage: 0,
    vin: null,
    purchase_price: 7900,
    purchase_currency: "USD",
    purchase_rate: 3.67,
    location: "",
    owner: "",
    status: "available",
    ...over,
  }) as Car;

describe("carPurchaseToCostFact", () => {
  it("uses AED per USD and converts cost to AED", () => {
    const f = carPurchaseToCostFact(baseCar({ purchase_rate: 3.67 }));
    expect(f.rateToAed).toBeCloseTo(3.67, 5);
    expect(f.amount * f.rateToAed).toBeCloseTo(7900 * 3.67, 5);
  });

  it("normalizes mistaken USD-per-AED (~0.27) to AED per USD", () => {
    const f = carPurchaseToCostFact(baseCar({ purchase_rate: 0.27 }));
    expect(f.rateToAed).toBeCloseTo(1 / 0.27, 5);
    expect(f.amount * f.rateToAed).toBeCloseTo(7900 / 0.27, 5);
  });

  it("falls back to dashboard USD rate when purchase_rate missing", () => {
    const dash = { USD: 0.272, DZD: 68, EUR: 0.25 };
    const f = carPurchaseToCostFact(baseCar({ purchase_rate: undefined }), dash);
    const aedPerUsd = 1 / 0.272;
    expect(f.rateToAed).toBeCloseTo(aedPerUsd, 5);
  });

  it("converts DZD purchase using DZD per AED => AED per DZD = 1/denom", () => {
    const f = carPurchaseToCostFact(
      baseCar({
        purchase_currency: "DZD",
        purchase_price: 2_800_000,
        purchase_rate: 68,
      })
    );
    expect(f.rateToAed).toBeCloseTo(1 / 68, 8);
    expect(f.amount * f.rateToAed).toBeCloseTo(2_800_000 / 68, 3);
  });
});
