import { describe, expect, it } from "vitest";
import type { Car } from "@/lib/types";
import { carPurchaseToCostFact, formLinesToExpenseFacts } from "@/app/deals/dealFinanceHelpers";

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
