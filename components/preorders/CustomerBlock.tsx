import type { PreorderForm } from "./types";

export default function CustomerBlock({
  form,
  setField,
}: {
  form: PreorderForm;
  setField: <K extends keyof PreorderForm>(key: K, value: PreorderForm[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Customer name</span>
        <input
          value={form.clientName}
          onChange={(e) => setField("clientName", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Phone</span>
        <input
          value={form.clientPhone}
          onChange={(e) => setField("clientPhone", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app">
        <span className="font-semibold">Passport number</span>
        <input
          value={form.clientPassport}
          onChange={(e) => setField("clientPassport", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
      <label className="space-y-1 text-xs text-app sm:col-span-2">
        <span className="font-semibold">Algeria address</span>
        <input
          value={form.clientAddress}
          onChange={(e) => setField("clientAddress", e.target.value)}
          className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
        />
      </label>
    </div>
  );
}
