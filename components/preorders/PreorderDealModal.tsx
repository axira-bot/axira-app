"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button } from "@heroui/react";
import CarSourceToggle from "./CarSourceToggle";
import CustomerBlock from "./CustomerBlock";
import PricingBlock from "./PricingBlock";
import PaymentBlock from "./PaymentBlock";
import { emptyPreorderForm, type PreorderForm } from "./types";
import { AppInputField, AppSelectField } from "@/components/ui/form-fields";

type Supplier = { id: string; name: string; country: string | null };
type CatalogItem = {
  id: string;
  supplier_id: string;
  brand: string;
  model: string;
  year: number | null;
  trim: string | null;
  color_options: string[] | null;
  base_cost: number;
  base_currency: "USD" | "AED";
  lead_time_days: number | null;
};

export default function PreorderDealModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<PreorderForm>(emptyPreorderForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);

  const setField = <K extends keyof PreorderForm>(key: K, value: PreorderForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!open) return;
    setForm(emptyPreorderForm());
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const res = await fetch("/api/catalog/suppliers", { cache: "no-store" });
      const data = await res.json().catch(() => []);
      if (res.ok) setSuppliers(Array.isArray(data) ? data : []);
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !form.supplierId) return;
    (async () => {
      const res = await fetch(`/api/catalog/suppliers?supplier_id=${encodeURIComponent(form.supplierId)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (res.ok) setCatalogItems(Array.isArray(data) ? data : []);
    })();
  }, [open, form.supplierId]);

  const selectedCatalogItem = useMemo(
    () => catalogItems.find((c) => c.id === form.supplierCatalogId) || null,
    [catalogItems, form.supplierCatalogId]
  );

  useEffect(() => {
    if (!selectedCatalogItem || form.source !== "PRE_ORDER_CATALOG") return;
    setForm((prev) => ({
      ...prev,
      brand: selectedCatalogItem.brand || prev.brand,
      model: selectedCatalogItem.model || prev.model,
      year: selectedCatalogItem.year ? String(selectedCatalogItem.year) : prev.year,
      trim: selectedCatalogItem.trim || prev.trim,
      color: selectedCatalogItem.color_options?.[0] || prev.color,
      sourceCost: String(selectedCatalogItem.base_cost || 0),
      sourceCurrency: selectedCatalogItem.base_currency || prev.sourceCurrency,
      leadTimeDays: selectedCatalogItem.lead_time_days ? String(selectedCatalogItem.lead_time_days) : prev.leadTimeDays,
      requireSupplierConfirmation: false,
    }));
  }, [selectedCatalogItem, form.source]);

  if (!open) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!form.clientName.trim() || !form.clientPhone.trim()) {
        throw new Error("Customer name and phone are required.");
      }
      if (!form.saleDzd.trim() || !form.sourceCost.trim() || !form.sourceRateToAed.trim() || !form.sourceRateToDzd.trim()) {
        throw new Error("Pricing fields are required.");
      }
      if (!form.brand.trim() || !form.model.trim()) {
        throw new Error("Brand and model are required.");
      }

      const payload = {
        source: form.source,
        date: form.date,
        agreed_delivery_date: form.agreed_delivery_date || null,
        notes: form.notes || null,
        rate: Number(form.sourceRateToAed),
        sale_dzd: Number(form.saleDzd),
        source_cost: Number(form.sourceCost),
        source_currency: form.sourceCurrency,
        source_rate_to_dzd: Number(form.sourceRateToDzd),
        source_rate_to_aed: Number(form.sourceRateToAed),
        client: {
          name: form.clientName,
          phone: form.clientPhone,
          passport_number: form.clientPassport || null,
          algeria_address: form.clientAddress || null,
        },
        catalog:
          form.source === "PRE_ORDER_CATALOG"
            ? {
                supplier_id: form.supplierId,
                supplier_catalog_id: form.supplierCatalogId,
                brand: form.brand,
                model: form.model,
                year: form.year ? Number(form.year) : null,
                trim: form.trim || null,
                color: form.color || null,
                lead_time_days: form.leadTimeDays ? Number(form.leadTimeDays) : null,
              }
            : undefined,
        custom_spec:
          form.source === "PRE_ORDER_CUSTOM"
            ? {
                supplier_id: form.supplierTbd ? null : form.supplierId || null,
                supplier_tbd: form.supplierTbd,
                brand: form.brand,
                model: form.model,
                year: form.year ? Number(form.year) : null,
                color: form.color || null,
                trim: form.trim || null,
                options: form.options || null,
                estimated_cost: Number(form.sourceCost),
                estimated_currency: form.sourceCurrency,
                supplier_confirmation_required: form.requireSupplierConfirmation,
              }
            : undefined,
        deposit:
          Number(form.depositDzd) > 0
            ? {
                amount_dzd: Number(form.depositDzd),
                pocket: form.depositPocket,
                method: form.depositMethod,
                date: form.date,
                notes: "Pre-order deposit",
              }
            : undefined,
      };

      const res = await fetch("/api/deals/preorders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to create pre-order.");
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create pre-order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => !saving && onClose()} />
      <div className="relative flex w-full max-w-4xl max-h-[92vh] flex-col overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
          <div>
            <div className="text-lg font-semibold text-app">Add Pre-Order Deal</div>
            <div className="text-xs text-muted">One deal flow (catalog or custom)</div>
          </div>
          <Button type="button" variant="outline" size="sm" isDisabled={saving} onPress={() => !saving && onClose()}>
            Close
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div className="rounded-md border border-app surface p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Customer</div>
            <CustomerBlock form={form} setField={setField} />
          </div>

          <div className="rounded-md border border-app surface p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Car Source</div>
            <CarSourceToggle source={form.source} onChange={(v) => setField("source", v)} />

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <AppSelectField
                label="Supplier"
                value={form.supplierId}
                onChange={(value) => setField("supplierId", value)}
                options={[
                  { value: "", label: "Select supplier" },
                  ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
                ]}
              />
              {form.source === "PRE_ORDER_CATALOG" ? (
                <AppSelectField
                  label="Catalog model"
                  value={form.supplierCatalogId}
                  onChange={(value) => setField("supplierCatalogId", value)}
                  options={[
                    { value: "", label: "Select model" },
                    ...catalogItems.map((catalogItem) => ({
                      value: catalogItem.id,
                      label: `${catalogItem.brand} ${catalogItem.model} ${catalogItem.year ? `(${catalogItem.year})` : ""}`,
                    })),
                  ]}
                />
              ) : (
                <label className="flex items-center gap-2 text-xs text-app">
                  <input
                    type="checkbox"
                    checked={form.supplierTbd}
                    onChange={(e) => setField("supplierTbd", e.target.checked)}
                  />
                  <span>Supplier TBD</span>
                </label>
              )}
              <AppInputField label="Brand" value={form.brand} onChange={(value) => setField("brand", value)} />
              <AppInputField label="Model" value={form.model} onChange={(value) => setField("model", value)} />
              <AppInputField label="Year" value={form.year} onChange={(value) => setField("year", value)} />
              <AppInputField label="Color" value={form.color} onChange={(value) => setField("color", value)} />
              <AppInputField label="Trim" value={form.trim} onChange={(value) => setField("trim", value)} />
              <AppInputField label="Lead time (days)" value={form.leadTimeDays} onChange={(value) => setField("leadTimeDays", value)} />
              {form.source === "PRE_ORDER_CUSTOM" && (
                <>
                  <AppInputField
                    label="Options / spec details"
                    value={form.options}
                    onChange={(value) => setField("options", value)}
                    className="sm:col-span-2"
                  />
                  <label className="flex items-center gap-2 text-xs text-amber-300 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={form.requireSupplierConfirmation}
                      onChange={(e) => setField("requireSupplierConfirmation", e.target.checked)}
                    />
                    <span>Supplier confirmation required before ORDERED transition.</span>
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="rounded-md border border-app surface p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Pricing</div>
            <PricingBlock form={form} setField={setField} />
          </div>

          <div className="rounded-md border border-app surface p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Payment</div>
            <PaymentBlock form={form} setField={setField} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AppInputField label="Deal date" type="date" value={form.date} onChange={(value) => setField("date", value)} />
            <AppInputField
              label="Agreed delivery date"
              type="date"
              value={form.agreed_delivery_date}
              onChange={(value) => setField("agreed_delivery_date", value)}
            />
            <AppInputField label="Notes" value={form.notes} onChange={(value) => setField("notes", value)} className="sm:col-span-2" />
          </div>

          {error ? (
            <Alert.Root status="danger">
              <Alert.Content>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-app pt-3">
          <Button type="button" variant="outline" size="sm" isDisabled={saving} onPress={() => !saving && onClose()}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" isDisabled={saving} onPress={() => void submit()}>
            {saving ? "Saving..." : "Create Pre-Order"}
          </Button>
        </div>
      </div>
    </div>
  );
}
