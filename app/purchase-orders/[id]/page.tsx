"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Button, Chip, Spinner } from "@heroui/react";
import { useAuth } from "@/lib/context/AuthContext";
import { formatDateForLocale, formatNumberForLocale, useI18n, type TranslateFn } from "@/lib/context/I18nContext";
import {
  carLifecycleLabel,
  carLocationLabel,
  dealLifecycleLabel,
  inventoryLifecycleLabel,
  pocketDetailLabel,
  poStatusLabel,
} from "@/lib/i18n/enumLabels";
import { CAR_LIFECYCLE_STATUSES, isCarLifecycleStatus, type CarLifecycleStatus } from "@/lib/cars/carLifecycleStatus";
import { cashPocketOptionsForCurrency, validatePocketForCurrency } from "@/lib/finance/cashPockets";
import { isValidIsoVin, normalizeVin } from "@/lib/vin/isoVin";

type PurchaseOrder = {
  id: string;
  po_number: string | null;
  status: string;
  currency: string;
  total_cost: number;
  paid_amount: number;
  supplier_owed: number;
  total_cost_aed?: number;
  paid_amount_aed?: number;
  supplier_owed_aed?: number;
  shipping_estimate?: number;
  other_fees?: number;
  items_subtotal?: number;
  expected_arrival_date: string | null;
  ordered_at: string | null;
  notes: string | null;
  source_market?: string | null;
  supplier_id?: string | null;
  suppliers?: { name?: string | null } | null;
};

type Item = {
  id: string;
  brand: string;
  model: string;
  year: number | null;
  color: string | null;
  vin: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  inventory_status: string;
  notes: string | null;
};

type Payment = {
  id: string;
  date: string | null;
  amount: number;
  currency: string;
  rate_snapshot?: number | null;
  aed_equivalent: number | null;
  amount_in_po_currency?: number | null;
  pocket: string | null;
  method: string | null;
  notes: string | null;
};

type ItemCar = { purchase_order_item_id: string; car_id: string };
type LinkedCar = {
  id: string;
  purchase_order_item_id: string | null;
  vin: string | null;
  status: string | null;
  location?: string | null;
  inventory_lifecycle_status: string | null;
  lifecycle_status?: string | null;
  vin_validated_at: string | null;
  vin_validated_by: string | null;
};

const inputCls =
  "w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]";

function sourceMarketLabel(t: TranslateFn, value: string | null | undefined): string {
  const v = String(value || "").toLowerCase();
  if (v === "china") return t("purchaseOrders.marketChina");
  if (v === "dubai") return t("purchaseOrders.marketDubai");
  if (v === "other") return t("purchaseOrders.marketOther");
  return value?.trim() || t("common.emiDash");
}

function paymentMethodLabelForPo(t: TranslateFn, method: string | null | undefined): string {
  const raw = String(method ?? "").trim();
  if (!raw) return "";
  const slug = raw.toLowerCase().replace(/\s+/g, "_");
  const key = `purchaseOrders.detail.paymentMethod.${slug}`;
  const translated = t(key);
  return translated === key ? raw : translated;
}

function coerceLifecycle(s: string | null | undefined): CarLifecycleStatus {
  const v = String(s ?? "").trim();
  return isCarLifecycleStatus(v) ? v : "ORDERED";
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { locale, t } = useI18n();
  const { isOwnerLike: isOwner, isManager } = useAuth();
  const fmtMoney = (v: number, c: string) =>
    `${formatNumberForLocale(locale, Number(v || 0), { maximumFractionDigits: 2 })} ${c}`;
  const dash = t("common.emiDash");
  const fmtDate = (value: string | null | undefined) => {
    if (!value) return dash;
    const d = value.includes("T") ? value.slice(0, 10) : value;
    return formatDateForLocale(locale, d, { day: "2-digit", month: "short", year: "numeric" }) || dash;
  };
  const fmtDateTime = (value: string | null | undefined) => {
    if (!value) return "";
    const s = formatDateForLocale(locale, value, { dateStyle: "short", timeStyle: "short" });
    return s || "";
  };
  const canValidateVin = isOwner || isManager;
  const canEditLifecycle = canValidateVin;
  const [row, setRow] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [itemCars, setItemCars] = useState<ItemCar[]>([]);
  const [cars, setCars] = useState<LinkedCar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveMode, setReceiveMode] = useState<"arrived" | "available">("arrived");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [vinDraft, setVinDraft] = useState<Record<string, string>>({});
  const [vinFieldError, setVinFieldError] = useState<Record<string, string>>({});
  const [validatingVinCarId, setValidatingVinCarId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [vinOverride, setVinOverride] = useState<{ carId: string; vin: string; reason: string } | null>(null);
  const [selectedLifecycleCarIds, setSelectedLifecycleCarIds] = useState<string[]>([]);
  const [bulkLifecycleStatus, setBulkLifecycleStatus] = useState<CarLifecycleStatus>("ORDERED");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [itemForm, setItemForm] = useState({
    brand: "",
    model: "",
    year: "",
    color: "",
    vin: "",
    quantity: "1",
    unit_cost: "0",
    notes: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    currency: "USD",
    rate_snapshot: "",
    pocket: "",
    method: "bank_transfer",
    notes: "",
  });
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [paymentMenuId, setPaymentMenuId] = useState<string | null>(null);

  const carsPerItem = useMemo(() => {
    const m = new Map<string, number>();
    itemCars.forEach((x) => m.set(x.purchase_order_item_id, (m.get(x.purchase_order_item_id) || 0) + 1));
    return m;
  }, [itemCars]);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${id}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.detail.loadFailed"));
      setRow(null);
      setItems([]);
      setPayments([]);
      setItemCars([]);
      setCars([]);
    } else {
      setRow((data.row as PurchaseOrder) || null);
      setItems((data.items as Item[]) || []);
      setPayments((data.payments as Payment[]) || []);
      setItemCars((data.itemCars as ItemCar[]) || []);
      setCars((data.cars as LinkedCar[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!successMessage) return;
    const timerId = window.setTimeout(() => setSuccessMessage(null), 5000);
    return () => window.clearTimeout(timerId);
  }, [successMessage]);

  useEffect(() => {
    setVinDraft((prev) => {
      const next = { ...prev };
      for (const c of cars) {
        const validated = Boolean(c.vin_validated_at);
        if (!validated) {
          if (next[c.id] === undefined) next[c.id] = (c.vin || "").trim();
        } else {
          delete next[c.id];
        }
      }
      return next;
    });
  }, [cars]);

  useEffect(() => {
    setSelectedLifecycleCarIds((prev) => prev.filter((carId) => cars.some((c) => c.id === carId)));
  }, [cars]);

  const toggleLifecycleCarSelection = (carId: string) => {
    setSelectedLifecycleCarIds((prev) =>
      prev.includes(carId) ? prev.filter((x) => x !== carId) : [...prev, carId]
    );
  };

  const updatePoCarLifecycle = async (carIds: string[], lifecycle_status: CarLifecycleStatus) => {
    if (!id || !carIds.length || !canEditLifecycle) return;
    const unique = [...new Set(carIds)];
    setLifecycleSaving(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${id}/cars/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ car_ids: unique, lifecycle_status }),
    });
    const data = await res.json().catch(() => ({}));
    setLifecycleSaving(false);
    if (!res.ok) {
      setError((data.error as string) || t("purchaseOrders.detail.failedLifecycleUpdate"));
      return;
    }
    const n = typeof data.updated_count === "number" ? data.updated_count : unique.length;
    setSuccessMessage(
      n > 1 ? t("purchaseOrders.detail.lifecycleUpdatedMany", { count: n }) : t("purchaseOrders.detail.lifecycleUpdatedOne")
    );
    setSelectedLifecycleCarIds((prev) => prev.filter((x) => !unique.includes(x)));
    await load();
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !isOwner) return;
    setSavingItem(true);
    const res = await fetch(`/api/purchase-orders/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            brand: itemForm.brand,
            model: itemForm.model,
            year: itemForm.year ? Number(itemForm.year) : null,
            color: itemForm.color || null,
            vin: itemForm.vin || null,
            quantity: Number(itemForm.quantity || 1),
            unit_cost: Number(itemForm.unit_cost || 0),
            notes: itemForm.notes || null,
          },
        ],
        create_inventory_rows: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingItem(false);
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.detail.addItemFailed"));
      return;
    }
    setItemForm({ brand: "", model: "", year: "", color: "", vin: "", quantity: "1", unit_cost: "0", notes: "" });
    load();
  };

  const resetPaymentFormAfterSave = () => {
    setEditingPaymentId(null);
    setPaymentForm((p) => ({
      date: new Date().toISOString().slice(0, 10),
      amount: "",
      currency: p.currency,
      rate_snapshot: "",
      pocket: "",
      method: "bank_transfer",
      notes: "",
    }));
  };

  const savePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !isOwner) return;
    const pocketErr = validatePocketForCurrency(paymentForm.pocket.trim(), paymentForm.currency);
    if (pocketErr) {
      setError(pocketErr);
      return;
    }
    setSavingPayment(true);
    setError(null);
    const payload = {
      date: paymentForm.date,
      amount: Number(paymentForm.amount || 0),
      currency: paymentForm.currency,
      rate_snapshot: paymentForm.rate_snapshot ? Number(paymentForm.rate_snapshot) : null,
      pocket: paymentForm.pocket.trim(),
      method: paymentForm.method,
      notes: paymentForm.notes || null,
    };
    const url = editingPaymentId
      ? `/api/purchase-orders/${id}/payments/${editingPaymentId}`
      : `/api/purchase-orders/${id}/payments`;
    const res = await fetch(url, {
      method: editingPaymentId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setSavingPayment(false);
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.detail.savePaymentFailed"));
      return;
    }
    resetPaymentFormAfterSave();
    setPaymentMenuId(null);
    load();
  };

  const startEditPayment = (p: Payment) => {
    setEditingPaymentId(p.id);
    setPaymentMenuId(null);
    setError(null);
    setPaymentForm({
      date: (p.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      amount: String(p.amount ?? ""),
      currency: p.currency || "USD",
      rate_snapshot: p.rate_snapshot != null && p.rate_snapshot !== undefined ? String(p.rate_snapshot) : "",
      pocket: (p.pocket || "").trim(),
      method: p.method || "bank_transfer",
      notes: p.notes || "",
    });
  };

  const cancelPaymentEdit = () => {
    setEditingPaymentId(null);
    setPaymentForm((p) => ({
      ...p,
      date: new Date().toISOString().slice(0, 10),
      amount: "",
      rate_snapshot: "",
      pocket: "",
      notes: "",
    }));
  };

  const deletePayment = async (paymentId: string) => {
    if (!id || !isOwner) return;
    if (!window.confirm(t("purchaseOrders.detail.deletePaymentConfirm"))) {
      setPaymentMenuId(null);
      return;
    }
    setError(null);
    const res = await fetch(`/api/purchase-orders/${id}/payments/${paymentId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setPaymentMenuId(null);
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.detail.deletePaymentFailed"));
      return;
    }
    if (editingPaymentId === paymentId) cancelPaymentEdit();
    load();
  };

  const validateVinForCar = async (carId: string) => {
    if (!id || !canValidateVin) return;
    const raw = vinDraft[carId] ?? "";
    const normalized = normalizeVin(raw);
    if (!isValidIsoVin(normalized)) {
      setVinFieldError((p) => ({
        ...p,
        [carId]: t("purchaseOrders.detail.vinInvalidFormat"),
      }));
      return;
    }
    setVinFieldError((p) => {
      const rest = { ...p };
      delete rest[carId];
      return rest;
    });
    setError(null);
    setValidatingVinCarId(carId);
    const res = await fetch(`/api/cars/validate-vin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        car_id: carId,
        purchase_order_id: id,
        vin: normalized,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setValidatingVinCarId(null);
    if (!res.ok) {
      setError((data.error as string) || t("purchaseOrders.detail.vinValidationFailed"));
      return;
    }
    setSuccessMessage(t("purchaseOrders.detail.vinValidatedSuccess"));
    await load();
  };

  const submitVinOverride = async () => {
    if (!id || !isOwner || !vinOverride) return;
    const normalized = normalizeVin(vinOverride.vin);
    if (!isValidIsoVin(normalized)) {
      setError(t("purchaseOrders.detail.vinNewInvalid"));
      return;
    }
    setError(null);
    setValidatingVinCarId(vinOverride.carId);
    const res = await fetch(`/api/cars/validate-vin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        car_id: vinOverride.carId,
        purchase_order_id: id,
        vin: normalized,
        confirm_override: true,
        override_reason: vinOverride.reason.trim() || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setValidatingVinCarId(null);
    if (!res.ok) {
      setError((data.error as string) || t("purchaseOrders.detail.vinUpdateFailed"));
      return;
    }
    setVinOverride(null);
    setSuccessMessage(t("purchaseOrders.detail.vinOverrideSuccess"));
    await load();
  };

  const receive = async (mode: "arrived" | "available") => {
    if (!id || !isOwner) return;
    setReceiving(true);
    const res = await fetch(`/api/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        item_ids: selectedItemIds.length ? selectedItemIds : undefined,
        vin_assignments: Object.entries(vinDraft)
          .map(([car_id, vin]) => ({ car_id, vin: vin.trim() }))
          .filter((x) => Boolean(x.vin)),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setReceiving(false);
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.detail.receiveFailed"));
      return;
    }
    load();
  };

  const itemsSubtotal = useMemo(
    () => items.reduce((sum, it) => sum + Number(it.total_cost || 0), 0),
    [items]
  );
  const adjustments = {
    shipping: Number(row?.shipping_estimate || 0),
    fees: Number(row?.other_fees || 0),
  };
  const computedGrandTotal = Number(row?.total_cost || (itemsSubtotal + adjustments.shipping + adjustments.fees));
  const paid = Number(row?.paid_amount || 0);
  const owed = Number(row?.supplier_owed ?? (computedGrandTotal - paid));

  return (
    <main className="min-h-full w-full min-w-0 space-y-5 p-6 text-foreground" style={{ background: "var(--color-bg)" }}>
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <Spinner size="md" color="danger" />
          <span className="text-sm text-default-500">{t("purchaseOrders.detail.loadingDetail")}</span>
        </div>
      ) : !row ? (
        <Alert.Root status="danger">
          <Alert.Content>
            <Alert.Description>{error || t("purchaseOrders.detail.poNotFoundShort")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : (
        <>
          <section className="rounded-xl border border-app bg-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{row.po_number || row.id}</h1>
                <p className="text-xs text-muted">
                  {t("purchaseOrders.detail.metaLine", {
                    supplier: row.suppliers?.name || row.supplier_id || dash,
                    market: sourceMarketLabel(t, row.source_market),
                    status: poStatusLabel(t, row.status),
                    ordered: row.ordered_at ? fmtDate(row.ordered_at) : dash,
                    eta: row.expected_arrival_date ? fmtDate(row.expected_arrival_date) : dash,
                  })}
                </p>
              </div>
              <div className="text-right text-sm">
                <p>
                  {t("purchaseOrders.detail.itemsSubtotal")}: {fmtMoney(itemsSubtotal, row.currency)}
                </p>
                <p>
                  {t("purchaseOrders.detail.shipping")}: {fmtMoney(adjustments.shipping, row.currency)} · {t("purchaseOrders.detail.otherFees")}: {fmtMoney(adjustments.fees, row.currency)}
                </p>
                <p>
                  {t("purchaseOrders.detail.total")}: {fmtMoney(computedGrandTotal, row.currency)}
                </p>
                <p>
                  {t("purchaseOrders.detail.paid")}: {fmtMoney(paid, row.currency)}
                </p>
                <p className={owed <= 0 ? "text-emerald-600 font-semibold" : "text-amber-700 font-semibold"}>
                  {t("purchaseOrders.detail.owed")}: {fmtMoney(owed, row.currency)}
                </p>
                <p className="text-xs text-muted">
                  {t("purchaseOrders.detail.aedViewLine", {
                    total: fmtMoney(Number(row.total_cost_aed || 0), "AED"),
                    paid: fmtMoney(Number(row.paid_amount_aed || 0), "AED"),
                    owed: fmtMoney(Number(row.supplier_owed_aed || 0), "AED"),
                  })}
                </p>
              </div>
            </div>
            {row.notes && <p className="mt-3 text-sm text-muted">{row.notes}</p>}
          </section>

          <section className="rounded-xl border border-app bg-panel p-4">
            <h2 className="mb-3 text-base font-semibold">{t("purchaseOrders.lineItems")}</h2>
            {canEditLifecycle && cars.length > 0 ? (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-app/60 bg-black/[0.02] px-3 py-2 text-xs">
                <span className="font-medium text-foreground">
                  {t("purchaseOrders.detail.carsSelected", { count: selectedLifecycleCarIds.length })}
                </span>
                <label className="flex items-center gap-1">
                  <span className="text-muted">{t("purchaseOrders.detail.newStatus")}:</span>
                  <select
                    className={inputCls}
                    disabled={lifecycleSaving}
                    value={bulkLifecycleStatus}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (isCarLifecycleStatus(v)) setBulkLifecycleStatus(v);
                    }}
                  >
                    {CAR_LIFECYCLE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {carLifecycleLabel(t, s)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="h-8 min-h-8 text-[11px]"
                  isDisabled={lifecycleSaving || selectedLifecycleCarIds.length === 0}
                  onPress={() => updatePoCarLifecycle(selectedLifecycleCarIds, bulkLifecycleStatus)}
                >
                  {t("purchaseOrders.detail.updateStatusSelected")}
                </Button>
              </div>
            ) : null}
            {isOwner && (
              <form className="mb-4 grid gap-2 md:grid-cols-8" onSubmit={addItem}>
                <input className={inputCls} placeholder={t("purchaseOrders.colBrand")} value={itemForm.brand} onChange={(e) => setItemForm((p) => ({ ...p, brand: e.target.value }))} />
                <input className={inputCls} placeholder={t("purchaseOrders.colModel")} value={itemForm.model} onChange={(e) => setItemForm((p) => ({ ...p, model: e.target.value }))} />
                <input className={inputCls} placeholder={t("purchaseOrders.colYear")} value={itemForm.year} onChange={(e) => setItemForm((p) => ({ ...p, year: e.target.value }))} />
                <input className={inputCls} placeholder={t("purchaseOrders.colColor")} value={itemForm.color} onChange={(e) => setItemForm((p) => ({ ...p, color: e.target.value }))} />
                <input className={inputCls} placeholder={t("purchaseOrders.detail.placeholderVinOptional")} value={itemForm.vin} onChange={(e) => setItemForm((p) => ({ ...p, vin: e.target.value }))} />
                <input className={inputCls} placeholder={t("purchaseOrders.detail.qty")} value={itemForm.quantity} onChange={(e) => setItemForm((p) => ({ ...p, quantity: e.target.value }))} />
                <input className={inputCls} placeholder={t("purchaseOrders.detail.placeholderUnitCost")} value={itemForm.unit_cost} onChange={(e) => setItemForm((p) => ({ ...p, unit_cost: e.target.value }))} />
                <Button type="submit" variant="primary" size="sm" isDisabled={savingItem}>
                  {savingItem ? t("purchaseOrders.detail.addingItem") : t("purchaseOrders.addItem")}
                </Button>
                <input className={`${inputCls} md:col-span-8`} placeholder={t("purchaseOrders.notes")} value={itemForm.notes} onChange={(e) => setItemForm((p) => ({ ...p, notes: e.target.value }))} />
              </form>
            )}
            <div className="responsive-table-wrap">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-2 py-2 text-left">{t("purchaseOrders.detail.carCol")}</th>
                    <th className="px-2 py-2 text-right">{t("purchaseOrders.detail.qty")}</th>
                    <th className="px-2 py-2 text-right">{t("purchaseOrders.detail.unit")}</th>
                    <th className="px-2 py-2 text-right">{t("purchaseOrders.detail.total")}</th>
                    <th className="px-2 py-2 text-left">{t("purchaseOrders.detail.itemStatus")}</th>
                    <th className="px-2 py-2 text-right">{t("purchaseOrders.detail.generatedCars")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-app/50">
                      <td className="px-2 py-2">
                        <div>
                          {it.brand} {it.model} {it.year || ""} {it.color || ""}
                        </div>
                        {it.vin ? (
                          <div className="text-[11px] text-muted">
                            {t("purchaseOrders.detail.vinColon")} {it.vin}
                          </div>
                        ) : null}
                        {cars
                          .filter((c) => c.purchase_order_item_id === it.id)
                          .map((c) => {
                            const validated = Boolean(c.vin_validated_at);
                            const displayVin = validated ? (c.vin || "").trim() : vinDraft[c.id] ?? "";
                            const err = vinFieldError[c.id];
                            const canEditField = canValidateVin && !validated;
                            const lifecycle = coerceLifecycle(c.lifecycle_status);
                            return (
                              <div key={c.id} className="mt-1 space-y-1 rounded border border-app/40 px-2 py-1 text-[10px]">
                                <div className="flex flex-wrap items-start gap-2">
                                  {canEditLifecycle ? (
                                    <input
                                      type="checkbox"
                                      className="mt-1.5"
                                      aria-label={t("purchaseOrders.detail.ariaSelectCarBulk", { id: c.id.slice(0, 8) })}
                                      checked={selectedLifecycleCarIds.includes(c.id)}
                                      disabled={lifecycleSaving}
                                      onChange={() => toggleLifecycleCarSelection(c.id)}
                                    />
                                  ) : null}
                                  <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="font-mono text-[9px] text-muted">{c.id.slice(0, 8)}</span>
                                  <Chip size="sm" variant="soft" className="h-5 px-2 text-[9px]">
                                    {carLifecycleLabel(t, lifecycle)}
                                  </Chip>
                                  {validated ? (
                                    <Chip size="sm" color="success" variant="soft" className="h-5 text-[9px]">
                                      {t("purchaseOrders.detail.chipVinOk")}
                                    </Chip>
                                  ) : (
                                    <Chip size="sm" color="warning" variant="soft" className="h-5 text-[9px]">
                                      {t("purchaseOrders.detail.chipVinPending")}
                                    </Chip>
                                  )}
                                </div>
                                {c.location ? (
                                  <div className="text-[9px] text-muted">
                                    {t("purchaseOrders.detail.locationPrefix")}{" "}
                                    <span className="font-medium text-app">{carLocationLabel(t, c.location)}</span>
                                  </div>
                                ) : null}
                                {(c.inventory_lifecycle_status || c.status) && (
                                  <div className="text-[9px] text-muted">
                                    {t("purchaseOrders.detail.legacyInventory", {
                                      inv: c.inventory_lifecycle_status
                                        ? inventoryLifecycleLabel(t, c.inventory_lifecycle_status)
                                        : dash,
                                      sales: c.status ? dealLifecycleLabel(t, c.status) : dash,
                                    })}
                                  </div>
                                )}
                                {canEditLifecycle ? (
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-[9px] uppercase text-muted">{t("purchaseOrders.detail.lifecycleLabel")}</span>
                                    <select
                                      className={`${inputCls} max-w-[14rem] py-1.5 text-[10px]`}
                                      value={lifecycle}
                                      disabled={lifecycleSaving}
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        if (!isCarLifecycleStatus(next) || next === lifecycle) return;
                                        updatePoCarLifecycle([c.id], next);
                                      }}
                                    >
                                      {CAR_LIFECYCLE_STATUSES.map((s) => (
                                        <option key={s} value={s}>
                                          {carLifecycleLabel(t, s)}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                ) : null}
                                  </div>
                                </div>
                                {validated && c.vin_validated_at ? (
                                  <div className="text-[9px] text-muted">
                                    {fmtDateTime(c.vin_validated_at)}
                                    {c.vin_validated_by
                                      ? ` · ${c.vin_validated_by.slice(0, 8)}…`
                                      : null}
                                  </div>
                                ) : null}
                                <input
                                  className={`${inputCls} mt-0.5 ${err ? "border-red-500" : ""}`}
                                  readOnly={!canEditField || lifecycleSaving}
                                  placeholder={t("purchaseOrders.detail.vinPlaceholder")}
                                  value={displayVin}
                                  onChange={(e) => {
                                    setVinFieldError((p) => {
                                      const rest = { ...p };
                                      delete rest[c.id];
                                      return rest;
                                    });
                                    setVinDraft((prev) => ({ ...prev, [c.id]: e.target.value.toUpperCase() }));
                                  }}
                                />
                                {err ? <p className="text-[9px] text-red-600">{err}</p> : null}
                                {canValidateVin && !validated ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="primary"
                                    className="mt-0.5 h-7 min-h-7 text-[10px]"
                                    isDisabled={
                                      lifecycleSaving ||
                                      validatingVinCarId === c.id ||
                                      !isValidIsoVin(normalizeVin(vinDraft[c.id] ?? ""))
                                    }
                                    onPress={() => validateVinForCar(c.id)}
                                  >
                                    {validatingVinCarId === c.id ? t("purchaseOrders.detail.validatingVin") : t("purchaseOrders.detail.validateVin")}
                                  </Button>
                                ) : null}
                                {validated && isOwner ? (
                                  <button
                                    type="button"
                                    className="mt-0.5 text-[10px] font-medium text-[var(--color-accent)] underline disabled:opacity-50"
                                    disabled={lifecycleSaving}
                                    onClick={() =>
                                      setVinOverride({
                                        carId: c.id,
                                        vin: (c.vin || "").trim(),
                                        reason: "",
                                      })
                                    }
                                  >
                                    {t("purchaseOrders.detail.changeVinOwner")}
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatNumberForLocale(locale, it.quantity, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-2 py-2 text-right">{fmtMoney(it.unit_cost, row.currency)}</td>
                      <td className="px-2 py-2 text-right">{fmtMoney(it.total_cost, row.currency)}</td>
                      <td className="px-2 py-2">
                        {inventoryLifecycleLabel(t, it.inventory_status)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatNumberForLocale(locale, carsPerItem.get(it.id) || 0, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-app bg-panel p-4">
            <h2 className="mb-3 text-base font-semibold">{t("purchaseOrders.detail.paymentLedger")}</h2>
            {isOwner && (
              <form className="mb-4 grid gap-2 md:grid-cols-7" onSubmit={savePayment}>
                {editingPaymentId ? (
                  <div className="md:col-span-7 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                    <span>{t("purchaseOrders.detail.editingPayment")}</span>
                    <button type="button" className="underline font-medium" onClick={cancelPaymentEdit}>
                      {t("purchaseOrders.detail.cancelEdit")}
                    </button>
                  </div>
                ) : null}
                <input className={inputCls} type="date" value={paymentForm.date} onChange={(e) => setPaymentForm((p) => ({ ...p, date: e.target.value }))} />
                <input className={inputCls} placeholder={t("purchaseOrders.placeholderAmount")} value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} />
                <select
                  className={inputCls}
                  value={paymentForm.currency}
                  onChange={(e) => {
                    const cur = e.target.value;
                    setPaymentForm((p) => {
                      const next = { ...p, currency: cur };
                      if (validatePocketForCurrency(p.pocket.trim(), cur)) {
                        next.pocket = "";
                      }
                      return next;
                    });
                  }}
                >
                  <option value="USD">USD</option>
                  <option value="AED">AED</option>
                  <option value="DZD">DZD</option>
                  <option value="EUR">EUR</option>
                </select>
                <input className={inputCls} placeholder={t("purchaseOrders.placeholderRateSnapshot")} value={paymentForm.rate_snapshot} onChange={(e) => setPaymentForm((p) => ({ ...p, rate_snapshot: e.target.value }))} />
                <select
                  required
                  className={inputCls}
                  value={paymentForm.pocket}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, pocket: e.target.value }))}
                >
                  <option value="">{t("purchaseOrders.detail.cashPocketRequired")}</option>
                  {cashPocketOptionsForCurrency(paymentForm.currency).map((opt) => (
                    <option key={opt} value={opt}>
                      {pocketDetailLabel(t, opt)}
                    </option>
                  ))}
                </select>
                <input className={inputCls} placeholder={t("purchaseOrders.placeholderMethod")} value={paymentForm.method} onChange={(e) => setPaymentForm((p) => ({ ...p, method: e.target.value }))} />
                <button
                  type="submit"
                  disabled={savingPayment}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingPayment
                    ? t("purchaseOrders.detail.savingPaymentShort")
                    : editingPaymentId
                      ? t("purchaseOrders.detail.saveChanges")
                      : t("purchaseOrders.detail.addPayment")}
                </button>
                <input className={`${inputCls} md:col-span-7`} placeholder={t("purchaseOrders.placeholderNotes")} value={paymentForm.notes} onChange={(e) => setPaymentForm((p) => ({ ...p, notes: e.target.value }))} />
              </form>
            )}
            <div className="responsive-table-wrap">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-2 py-2 text-left">{t("purchaseOrders.detail.paymentsTableDate")}</th>
                    <th className="px-2 py-2 text-right">{t("purchaseOrders.detail.paymentsTableAmount")}</th>
                    <th className="px-2 py-2 text-right">{t("purchaseOrders.detail.paymentsTablePoEq")}</th>
                    <th className="px-2 py-2 text-right">{t("purchaseOrders.detail.paymentsTableAedEq")}</th>
                    <th className="px-2 py-2 text-left">{t("purchaseOrders.detail.paymentsTablePocket")}</th>
                    <th className="px-2 py-2 text-left">{t("purchaseOrders.detail.paymentsTableMethod")}</th>
                    <th className="px-2 py-2 text-left">{t("purchaseOrders.detail.paymentsTableNotes")}</th>
                    {isOwner ? <th className="px-2 py-2 w-10 text-right"> </th> : null}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-app/50">
                      <td className="px-2 py-2">{p.date ? fmtDate(p.date) : dash}</td>
                      <td className="px-2 py-2 text-right">{fmtMoney(p.amount, p.currency)}</td>
                      <td className="px-2 py-2 text-right">{fmtMoney(p.amount_in_po_currency || 0, row.currency)}</td>
                      <td className="px-2 py-2 text-right">{fmtMoney(p.aed_equivalent || 0, "AED")}</td>
                      <td className="px-2 py-2">{p.pocket ? pocketDetailLabel(t, p.pocket) : dash}</td>
                      <td className="px-2 py-2">{paymentMethodLabelForPo(t, p.method) || dash}</td>
                      <td className="px-2 py-2">{p.notes || dash}</td>
                      {isOwner ? (
                        <td className="px-2 py-2 text-right">
                          <div className="relative inline-block text-left">
                            <button
                              type="button"
                              className="rounded px-1.5 py-0.5 text-lg leading-none text-muted hover:bg-black/5"
                              aria-label={t("purchaseOrders.detail.paymentActions")}
                              onClick={() => setPaymentMenuId((open) => (open === p.id ? null : p.id))}
                            >
                              ⋮
                            </button>
                            {paymentMenuId === p.id ? (
                              <div className="absolute right-0 z-20 mt-1 min-w-[8rem] rounded-md border border-app bg-panel py-1 text-xs shadow-md">
                                <button
                                  type="button"
                                  className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                                  onClick={() => startEditPayment(p)}
                                >
                                  {t("purchaseOrders.detail.paymentMenuEdit")}
                                </button>
                                <button
                                  type="button"
                                  className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-red-50"
                                  onClick={() => deletePayment(p.id)}
                                >
                                  {t("purchaseOrders.detail.paymentMenuDelete")}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {successMessage ? (
            <Alert.Root status="success">
              <Alert.Content>
                <Alert.Description>{successMessage}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ) : null}

          {isOwner && (
            <section className="rounded-xl border border-app bg-panel p-4">
              <h2 className="mb-3 text-base font-semibold">{t("purchaseOrders.detail.receiveWorkflowHeading")}</h2>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">{t("purchaseOrders.detail.receiveMode")}:</span>
                <select
                  className={inputCls}
                  value={receiveMode}
                  onChange={(e) => setReceiveMode(e.target.value as "arrived" | "available")}
                >
                  <option value="arrived">{t("purchaseOrders.detail.receiveAsArrived")}</option>
                  <option value="available">{t("purchaseOrders.detail.receiveAsAvailable")}</option>
                </select>
              </div>
              <div className="mb-3 grid gap-2 md:grid-cols-2">
                {items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 rounded border border-app/40 px-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedItemIds.includes(it.id)}
                      onChange={(e) =>
                        setSelectedItemIds((prev) =>
                          e.target.checked ? [...prev, it.id] : prev.filter((x) => x !== it.id)
                        )
                      }
                    />
                    <span>
                      {it.brand} {it.model}{" "}
                      {t("purchaseOrders.detail.qtyDot", {
                        n: formatNumberForLocale(locale, it.quantity, { maximumFractionDigits: 0 }),
                      })}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isDisabled={receiving}
                  onPress={() => receive(receiveMode)}
                >
                  {receiving
                    ? t("purchaseOrders.detail.receiveProcessing")
                    : receiveMode === "available"
                      ? t("purchaseOrders.detail.receiveAsAvailable")
                      : t("purchaseOrders.detail.receiveAsArrived")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  isDisabled={receiving}
                  onPress={() => receive("available")}
                >
                  {t("purchaseOrders.detail.receiveAsAvailable")}
                </Button>
              </div>
            </section>
          )}
          {error ? (
            <Alert.Root status="danger">
              <Alert.Content>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ) : null}

          {vinOverride ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="vin-override-title"
            >
              <div className="w-full max-w-md rounded-lg border border-app bg-panel p-4 shadow-lg">
                <h2 id="vin-override-title" className="mb-3 text-base font-semibold">
                  {t("purchaseOrders.detail.vinOverrideTitle")}
                </h2>
                <p className="mb-3 text-xs text-muted">{t("purchaseOrders.detail.vinOverrideBody")}</p>
                <label className="mb-2 block text-xs font-medium">
                  {t("purchaseOrders.detail.vinOverrideNew")}
                  <input
                    className={`${inputCls} mt-1`}
                    value={vinOverride.vin}
                    onChange={(e) => setVinOverride((p) => (p ? { ...p, vin: e.target.value.toUpperCase() } : p))}
                  />
                </label>
                <label className="mb-3 block text-xs font-medium">
                  {t("purchaseOrders.detail.vinOverrideReason")}
                  <input
                    className={`${inputCls} mt-1`}
                    placeholder={t("purchaseOrders.detail.vinOverridePlaceholder")}
                    value={vinOverride.reason}
                    onChange={(e) => setVinOverride((p) => (p ? { ...p, reason: e.target.value } : p))}
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onPress={() => setVinOverride(null)}>
                    {t("purchaseOrders.detail.detailCancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    isDisabled={validatingVinCarId !== null || !isValidIsoVin(normalizeVin(vinOverride.vin))}
                    onPress={() => submitVinOverride()}
                  >
                    {t("purchaseOrders.detail.replaceVin")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
