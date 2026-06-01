import type { PreorderForm } from "./types";
import {
  enteredPurchaseCostToCostFact,
  isPlausibleRateToAed,
} from "@/app/deals/dealFinanceHelpers";

function toNum(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function PricingBlock({
  form,
  setField,
  readOnly = false,
}: {
  form: PreorderForm;
  setField: <K extends keyof PreorderForm>(key: K, value: PreorderForm[K]) => void;
  readOnly?: boolean;
}) {
  const saleDzd = toNum(form.saleDzd);
  const sourceCost = toNum(form.sourceCost);
  const rateToDzd = toNum(form.sourceRateToDzd);
  const costRateToAed = toNum(form.sourceRateToAed);
  const saleRateDzdPerAed = toNum(form.saleRateDzdPerAed);
  const sourceCurrency = form.sourceCurrency;

  const costFact = enteredPurchaseCostToCostFact({
    amount: sourceCost,
    currency: sourceCurrency,
    purchaseRate: sourceCurrency === "AED" ? 1 : costRateToAed || null,
  });

  const sourceCostDzd = sourceCost * rateToDzd;
  const saleAed = saleRateDzdPerAed > 0 ? saleDzd / saleRateDzdPerAed : 0;
  const sourceAed = costFact.rateToAed > 0 ? sourceCost * costFact.rateToAed : 0;
  const marginDzd = saleDzd - sourceCostDzd;
  const marginAed = saleAed - sourceAed;
  const marginPct = saleDzd > 0 ? (marginDzd / saleDzd) * 100 : 0;

  const costRateInvalid =
    sourceCurrency !== "AED" &&
    costRateToAed > 0 &&
    !isPlausibleRateToAed(sourceCurrency, costFact.rateToAed);
  const saleRateInvalid = saleRateDzdPerAed > 0 && !(saleRateDzdPerAed >= 40 && saleRateDzdPerAed <= 120);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Sale price DZD</span>
        <input
          type="number"
          value={form.saleDzd}
          onChange={(e) => setField("saleDzd", e.target.value)}
          readOnly={readOnly}
          title={readOnly ? "List price is set by owner. Manager can adjust from Deals if needed." : undefined}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app read-only:bg-muted/30"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Sale rate (DZD per AED)</span>
        <input
          type="number"
          step="any"
          value={form.saleRateDzdPerAed}
          onChange={(e) => setField("saleRateDzdPerAed", e.target.value)}
          readOnly={readOnly}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app read-only:bg-muted/30"
        />
        <p className="text-[11px] leading-snug text-muted">
          Locked at deal creation. Sale in AED = sale DZD ÷ this rate.
        </p>
        {saleRateInvalid ? (
          <p className="text-[11px] text-amber-800">Typical range ~55–75 DZD per AED.</p>
        ) : null}
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Source cost</span>
        <input
          type="number"
          value={form.sourceCost}
          onChange={(e) => setField("sourceCost", e.target.value)}
          readOnly={readOnly}
          title={readOnly ? "Cost snapshot from list — contact a manager to override." : undefined}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app read-only:bg-muted/30"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Source currency</span>
        <select
          value={form.sourceCurrency}
          onChange={(e) => {
            const cur = e.target.value as "USD" | "AED";
            setField("sourceCurrency", cur);
            if (cur === "AED") setField("sourceRateToAed", "1");
          }}
          disabled={readOnly}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app disabled:opacity-70"
        >
          <option value="USD">USD</option>
          <option value="AED">AED</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Cost rate (DZD per 1 USD)</span>
        <input
          type="number"
          step="any"
          value={form.sourceRateToDzd}
          onChange={(e) => setField("sourceRateToDzd", e.target.value)}
          readOnly={readOnly}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app read-only:bg-muted/30"
        />
        <p className="text-[11px] leading-snug text-muted">For DZD equivalent of source cost only.</p>
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">
          {sourceCurrency === "AED"
            ? "Cost rate (AED)"
            : `Cost rate (AED per 1 ${sourceCurrency})`}
        </span>
        <input
          type="number"
          step="any"
          value={form.sourceRateToAed}
          onChange={(e) => setField("sourceRateToAed", e.target.value)}
          readOnly={readOnly || sourceCurrency === "AED"}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app read-only:bg-muted/30"
        />
        <p className="text-[11px] leading-snug text-muted">
          {sourceCurrency === "AED"
            ? "Always 1 for AED cost."
            : "Multiply source cost to get AED (e.g. ~3.67 for USD). Do not use DZD-per-AED here."}
        </p>
        {costRateInvalid ? (
          <p className="text-[11px] text-amber-800">
            Rate out of range for {sourceCurrency}. Use AED per 1 {sourceCurrency} (about 0.1–50), not DZD scale.
          </p>
        ) : null}
      </label>

      <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Sale AED (preview)</span>
          <span>{saleAed.toLocaleString("en-US", { maximumFractionDigits: 2 })} AED</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <span>Cost DZD equivalent</span>
          <span>{sourceCostDzd.toLocaleString("en-US")} DZD</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <span>Cost AED (preview)</span>
          <span>{sourceAed.toLocaleString("en-US", { maximumFractionDigits: 2 })} AED</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <span>Gross margin DZD</span>
          <span>{marginDzd.toLocaleString("en-US")} DZD</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <span>Gross margin AED</span>
          <span>{marginAed.toLocaleString("en-US", { maximumFractionDigits: 2 })} AED</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 font-semibold">
          <span>Gross margin %</span>
          <span>{marginPct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
