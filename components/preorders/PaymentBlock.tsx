import type { PreorderForm } from "./types";

export default function PaymentBlock({
  form,
  setField,
}: {
  form: PreorderForm;
  setField: <K extends keyof PreorderForm>(key: K, value: PreorderForm[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Deposit DZD (optional)</span>
        <input
          type="number"
          value={form.depositDzd}
          onChange={(e) => setField("depositDzd", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Cash pocket</span>
        <input
          value={form.depositPocket}
          onChange={(e) => setField("depositPocket", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Payment method</span>
        <input
          value={form.depositMethod}
          onChange={(e) => setField("depositMethod", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
    </div>
  );
}
