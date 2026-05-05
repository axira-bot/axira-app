import type { PreorderForm } from "./types";
import { AppInputField, AppSelectField } from "@/components/ui/form-fields";

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
      <AppInputField label="Sale price DZD" type="number" value={form.saleDzd} onChange={(value) => setField("saleDzd", value)} />
      <AppInputField label="Source cost" type="number" value={form.sourceCost} onChange={(value) => setField("sourceCost", value)} />
      <AppSelectField
        label="Source currency"
        value={form.sourceCurrency}
        onChange={(value) => setField("sourceCurrency", value as "USD" | "AED")}
        options={[
          { value: "USD", label: "USD" },
          { value: "AED", label: "AED" },
        ]}
      />
      <AppInputField label="Rate to DZD" type="number" value={form.sourceRateToDzd} onChange={(value) => setField("sourceRateToDzd", value)} />
      <AppInputField label="Rate to AED" type="number" value={form.sourceRateToAed} onChange={(value) => setField("sourceRateToAed", value)} />

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
