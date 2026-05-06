import type { PreorderForm } from "./types";
import { AppInputField } from "@/components/ui/form-fields";

export default function PaymentBlock({
  form,
  setField,
}: {
  form: PreorderForm;
  setField: <K extends keyof PreorderForm>(key: K, value: PreorderForm[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <AppInputField
        label="Deposit DZD (optional)"
        type="number"
        value={form.depositDzd}
        onChange={(value) => setField("depositDzd", value)}
      />
      <AppInputField label="Cash pocket" value={form.depositPocket} onChange={(value) => setField("depositPocket", value)} />
      <AppInputField label="Payment method" value={form.depositMethod} onChange={(value) => setField("depositMethod", value)} />
    </div>
  );
}
