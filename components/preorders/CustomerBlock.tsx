import type { PreorderForm } from "./types";
import { AppInputField } from "@/components/ui/form-fields";

export default function CustomerBlock({
  form,
  setField,
}: {
  form: PreorderForm;
  setField: <K extends keyof PreorderForm>(key: K, value: PreorderForm[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <AppInputField label="Customer name" value={form.clientName} onChange={(value) => setField("clientName", value)} />
      <AppInputField label="Phone" value={form.clientPhone} onChange={(value) => setField("clientPhone", value)} />
      <AppInputField label="Passport number" value={form.clientPassport} onChange={(value) => setField("clientPassport", value)} />
      <AppInputField
        label="Algeria address"
        value={form.clientAddress}
        onChange={(value) => setField("clientAddress", value)}
        className="sm:col-span-2"
      />
    </div>
  );
}
