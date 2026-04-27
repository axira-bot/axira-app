import type { PreorderForm } from "./types";

function toNum(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function PricingBlock({
  form,
  setField,
}: {
  form: PreorderForm;
  setField: <K extends keyof PreorderForm>(key: K, value: PreorderForm[K]) => void;
}) {
  const saleDzd = toNum(form.saleDzd);
  const sourceCost = toNum(form.sourceCost);
  const rateToDzd = toNum(form.sourceRateToDzd);
  const rateToAed = toNum(form.sourceRateToAed);
  const sourceCostDzd = sourceCost * rateToDzd;
  const saleAed = rateToAed > 0 ? saleDzd / rateToAed : 0;
  const sourceAed = sourceCost * rateToAed;
  const marginDzd = saleDzd - sourceCostDzd;
  const marginAed = saleAed - sourceAed;
  const marginPct = saleDzd > 0 ? (marginDzd / saleDzd) * 100 : 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Sale price DZD</span>
        <input
          type="number"
          value={form.saleDzd}
          onChange={(e) => setField("saleDzd", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Source cost</span>
        <input
          type="number"
          value={form.sourceCost}
          onChange={(e) => setField("sourceCost", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Source currency</span>
        <select
          value={form.sourceCurrency}
          onChange={(e) => setField("sourceCurrency", e.target.value as "USD" | "AED")}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        >
          <option value="USD">USD</option>
          <option value="AED">AED</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Rate to DZD</span>
        <input
          type="number"
          value={form.sourceRateToDzd}
          onChange={(e) => setField("sourceRateToDzd", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Rate to AED</span>
        <input
          type="number"
          value={form.sourceRateToAed}
          onChange={(e) => setField("sourceRateToAed", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>

      <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Cost DZD equivalent</span>
          <span>{sourceCostDzd.toLocaleString("en-US")} DZD</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <span>Gross margin DZD</span>
          <span>{marginDzd.toLocaleString("en-US")} DZD</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <span>Gross margin AED</span>
          <span>{marginAed.toLocaleString("en-US")} AED</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 font-semibold">
          <span>Gross margin %</span>
          <span>{marginPct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
