"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "@heroui/react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";
import { normalizeRole } from "@/lib/auth/roles";
import { cashPocketOptionsForCurrency, validatePocketForCurrency } from "@/lib/finance/cashPockets";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { formatDateForLocale, formatNumberForLocale, useI18n } from "@/lib/context/I18nContext";
import { pocketDetailLabel, poStatusLabel } from "@/lib/i18n/enumLabels";

type Supplier = { id: string; name: string | null };
type PurchaseOrder = {
  id: string;
  po_number: string | null;
  supplier_id: string | null;
  source_market: string | null;
  currency: string;
  status: string;
  total_cost: number;
  paid_amount: number;
  supplier_owed: number;
  expected_arrival_date: string | null;
  created_at: string | null;
};
type SupplierCatalog = {
  id: string;
  brand: string;
  model: string;
  year: number | null;
};
type PoLineItem = {
  rowId: string;
  sourceMode: "catalog" | "manual";
  catalogId: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  quantity: string;
  unitPrice: string;
  notes: string;
};
type PoPaymentDraft = {
  rowId: string;
  date: string;
  amount: string;
  currency: "USD" | "AED" | "DZD" | "EUR";
  rate_snapshot: string;
  pocket: string;
  method: string;
  notes: string;
};

const inputCls =
  "w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]";

export default function PurchaseOrdersPage() {
  const { locale, t } = useI18n();
  const dash = t("common.emiDash");
  const fmtMoney = (amount: number, currency: string) =>
    `${formatNumberForLocale(locale, Number(amount || 0), { maximumFractionDigits: 2 })} ${currency || ""}`.trim();
  const fmtDate = (value: string | null | undefined) => {
    if (!value) return dash;
    const d = value.includes("T") ? value.slice(0, 10) : value;
    const s = formatDateForLocale(locale, d, { day: "2-digit", month: "short", year: "numeric" });
    return s || dash;
  };
  const { user, profile, permissions, role } = useAuth();
  const effectiveRole = useMemo(() => {
    const metaRole = (user?.app_metadata as { role?: string } | undefined)?.role;
    return normalizeRole(profile?.role ?? metaRole ?? role ?? "");
  }, [user, profile, role]);
  const isPrivileged = ["owner", "manager", "admin", "super_admin"].includes(effectiveRole);
  const isOwner = ["owner", "admin", "super_admin"].includes(effectiveRole);
  const canManageSuppliers = Boolean(
    permissions.suppliers ||
      ["owner", "admin", "super_admin", "manager"].includes(effectiveRole)
  );
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalogRows, setCatalogRows] = useState<SupplierCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [eligibility, setEligibility] = useState<"in_transit_or_arrived" | "arrived_only">("in_transit_or_arrived");
  const [savingEligibility, setSavingEligibility] = useState(false);
  const [form, setForm] = useState({
    supplier_id: "",
    source_market: "china",
    currency: "USD",
    expected_arrival_date: "",
    notes: "",
  });
  const [lineItems, setLineItems] = useState<PoLineItem[]>([
    {
      rowId: "row-1",
      sourceMode: "manual",
      catalogId: "",
      brand: "",
      model: "",
      year: "",
      color: "",
      quantity: "1",
      unitPrice: "0",
      notes: "",
    },
  ]);
  const [shippingEstimate, setShippingEstimate] = useState("0");
  const [otherFees, setOtherFees] = useState("0");
  const [createInventoryRows, setCreateInventoryRows] = useState(true);
  const [payments, setPayments] = useState<PoPaymentDraft[]>([
    {
      rowId: "pay-1",
      date: new Date().toISOString().slice(0, 10),
      amount: "",
      currency: "USD",
      rate_snapshot: "",
      pocket: "",
      method: "bank_transfer",
      notes: "",
    },
  ]);

  const supplierMap = useMemo(() => {
    const m = new Map<string, string>();
    suppliers.forEach((s) => m.set(s.id, s.name || t("purchaseOrders.unknown")));
    return m;
  }, [suppliers, t]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    const [poRes, suppliersRes, settingRes, catalogRes] = await Promise.all([
      fetch(
        `/api/purchase-orders?supplier_id=${encodeURIComponent(supplierFilter)}&status=${encodeURIComponent(statusFilter)}&page=${page}&pageSize=${pageSize}`,
        { cache: "no-store" }
      ),
      fetch("/api/suppliers?page=1&pageSize=200", { cache: "no-store" }),
      fetch("/api/purchase-orders/settings", { cache: "no-store" }),
      supabase.from("supplier_catalog").select("id, brand, model, year").eq("active", true).order("brand", { ascending: true }),
    ]);
    const poData = await poRes.json().catch(() => ({}));
    const suppliersData = await suppliersRes.json().catch(() => ({}));
    if (!poRes.ok) {
      setError(poData.error || t("purchaseOrders.listLoadFailed"));
      setRows([]);
    } else {
      setRows((poData.rows as PurchaseOrder[] | undefined) || []);
      setTotal(Number(poData.total || 0));
    }
    if (!suppliersRes.ok) {
      setSuppliers([]);
      setError((prev) => prev ?? suppliersData.error ?? t("purchaseOrders.listLoadSuppliersFailed"));
    } else {
      const activeSuppliers = ((suppliersData.rows as Array<Supplier & { active?: boolean }> | undefined) ?? [])
        .filter((row) => row.active !== false)
        .map((row) => ({ id: row.id, name: row.name ?? null }));
      setSuppliers(activeSuppliers);
    }
    setCatalogRows((catalogRes.data as SupplierCatalog[]) || []);
    const settingData = await settingRes.json().catch(() => ({}));
    if (settingRes.ok) {
      const val = settingData.po_deal_eligibility;
      if (val === "arrived_only" || val === "in_transit_or_arrived") setEligibility(val);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierFilter, statusFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [supplierFilter, statusFilter]);

  const createPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPrivileged) return;
    setSaving(true);
    setError(null);
    for (const payment of payments) {
      if (Number(payment.amount || 0) <= 0) continue;
      const pocketErr = validatePocketForCurrency(payment.pocket.trim(), payment.currency);
      if (pocketErr) {
        setSaving(false);
        setError(pocketErr);
        return;
      }
    }

    const normalizedItems = lineItems
      .map((item) => ({
        brand: item.brand.trim(),
        model: item.model.trim(),
        year: item.year ? Number(item.year) : null,
        color: item.color.trim() || null,
        quantity: Math.max(1, Number(item.quantity || 1)),
        unit_cost: Number(item.unitPrice || 0),
        notes: item.notes.trim() || null,
      }))
      .filter((item) => item.brand && item.model && item.quantity > 0);
    if (!normalizedItems.length) {
      setSaving(false);
      setError(t("purchaseOrders.lineItemRequired"));
      return;
    }
    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_id: form.supplier_id || null,
        source_market: form.source_market,
        currency: form.currency,
        expected_arrival_date: form.expected_arrival_date || null,
        notes: form.notes || null,
        status: "ordered",
        shipping_estimate: Number(shippingEstimate || 0),
        other_fees: Number(otherFees || 0),
        create_inventory_rows: createInventoryRows,
        items: normalizedItems,
        initial_payments: payments
          .map((payment) => ({
            date: payment.date || null,
            amount: Number(payment.amount || 0),
            currency: payment.currency,
            rate_snapshot: payment.rate_snapshot ? Number(payment.rate_snapshot) : null,
            pocket: payment.pocket || null,
            method: payment.method || null,
            notes: payment.notes || null,
          }))
          .filter((payment) => Number(payment.amount || 0) > 0),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.createFailed"));
      return;
    }
    setForm({ supplier_id: "", source_market: "china", currency: "USD", expected_arrival_date: "", notes: "" });
    setLineItems([
      {
        rowId: `row-${Date.now()}`,
        sourceMode: "manual",
        catalogId: "",
        brand: "",
        model: "",
        year: "",
        color: "",
        quantity: "1",
        unitPrice: "0",
        notes: "",
      },
    ]);
    setShippingEstimate("0");
    setOtherFees("0");
    setCreateInventoryRows(true);
    setPayments([
      {
        rowId: `pay-${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        amount: "",
        currency: "USD",
        rate_snapshot: "",
        pocket: "",
        method: "bank_transfer",
        notes: "",
      },
    ]);
    fetchAll();
  };

  const saveEligibility = async (nextValue: "in_transit_or_arrived" | "arrived_only") => {
    if (!isOwner) return;
    setSavingEligibility(true);
    setEligibility(nextValue);
    const res = await fetch("/api/purchase-orders/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ po_deal_eligibility: nextValue }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingEligibility(false);
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.eligibilitySaveFailed"));
    }
  };

  const removePo = async (id: string) => {
    if (!isOwner) return;
    if (!window.confirm(t("purchaseOrders.deleteConfirm"))) return;
    setError(null);
    const res = await fetch(`/api/purchase-orders/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || t("purchaseOrders.deleteFailed"));
      return;
    }
    fetchAll();
  };

  const stats = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += Number(row.total_cost || 0);
        acc.paid += Number(row.paid_amount || 0);
        acc.owed += Number(row.supplier_owed || 0);
        return acc;
      },
      { total: 0, paid: 0, owed: 0 }
    );
  }, [rows]);

  const itemSubtotal = useMemo(
    () =>
      lineItems.reduce(
        (sum, item) =>
          sum + Math.max(1, Number(item.quantity || 1)) * Math.max(0, Number(item.unitPrice || 0)),
        0
      ),
    [lineItems]
  );
  const shippingNum = Math.max(0, Number(shippingEstimate || 0));
  const otherFeesNum = Math.max(0, Number(otherFees || 0));
  const grandTotal = itemSubtotal + shippingNum + otherFeesNum;

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        rowId: `row-${Date.now()}-${prev.length + 1}`,
        sourceMode: "manual",
        catalogId: "",
        brand: "",
        model: "",
        year: "",
        color: "",
        quantity: "1",
        unitPrice: "0",
        notes: "",
      },
    ]);
  };
  const addPaymentRow = () => {
    setPayments((prev) => [
      ...prev,
      {
        rowId: `pay-${Date.now()}-${prev.length + 1}`,
        date: new Date().toISOString().slice(0, 10),
        amount: "",
        currency: form.currency as "USD" | "AED" | "DZD" | "EUR",
        rate_snapshot: "",
        pocket: "",
        method: "bank_transfer",
        notes: "",
      },
    ]);
  };
  const removePaymentRow = (rowId: string) => {
    setPayments((prev) => (prev.length === 1 ? prev : prev.filter((x) => x.rowId !== rowId)));
  };
  const updatePaymentRow = (rowId: string, field: keyof PoPaymentDraft, value: string) => {
    setPayments((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        const next = { ...row, [field]: value } as PoPaymentDraft;
        if (field === "currency") {
          const cur = value as PoPaymentDraft["currency"];
          if (validatePocketForCurrency(next.pocket.trim(), cur)) {
            next.pocket = "";
          }
        }
        return next;
      })
    );
  };

  const removeLineItem = (rowId: string) => {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((x) => x.rowId !== rowId)));
  };

  const updateLineItem = (rowId: string, field: keyof PoLineItem, value: string) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.rowId !== rowId) return item;
        if (field === "catalogId") {
          const selected = catalogRows.find((row) => row.id === value);
          if (!selected) return { ...item, catalogId: value };
          return {
            ...item,
            catalogId: value,
            brand: selected.brand || "",
            model: selected.model || "",
            year: selected.year ? String(selected.year) : "",
          };
        }
        return { ...item, [field]: value };
      })
    );
  };

  return (
    <main className="min-h-full space-y-5 p-6 text-foreground" style={{ background: "var(--color-bg)" }}>
      {error ? (
        <Alert.Root status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("purchaseOrders.title")}</h1>
          <p className="text-xs text-muted">{t("purchaseOrders.subtitle")}</p>
        </div>
        {canManageSuppliers ? (
          <Link
            href="/suppliers"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            {t("purchaseOrders.manageSuppliers")}
          </Link>
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-app bg-panel p-3">
          <p className="text-xs text-muted">{t("purchaseOrders.totalCost")}</p>
          <p className="text-lg font-semibold">{fmtMoney(stats.total, "USD")}</p>
        </div>
        <div className="rounded-xl border border-app bg-panel p-3">
          <p className="text-xs text-muted">{t("purchaseOrders.paid")}</p>
          <p className="text-lg font-semibold">{fmtMoney(stats.paid, "USD")}</p>
        </div>
        <div className="rounded-xl border border-app bg-panel p-3">
          <p className="text-xs text-muted">{t("purchaseOrders.supplierOwed")}</p>
          <p className="text-lg font-semibold">{fmtMoney(stats.owed, "USD")}</p>
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-app bg-panel p-4 md:grid-cols-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted">{t("purchaseOrders.filterSupplier")}</span>
          <select className={inputCls} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">{t("purchaseOrders.allSuppliers")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || t("purchaseOrders.unknown")}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">{t("purchaseOrders.status")}</span>
          <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t("purchaseOrders.filterStatusAll")}</option>
            <option value="draft">{poStatusLabel(t, "draft")}</option>
            <option value="ordered">{poStatusLabel(t, "ordered")}</option>
            <option value="partial_received">{poStatusLabel(t, "partial_received")}</option>
            <option value="received">{poStatusLabel(t, "received")}</option>
            <option value="cancelled">{poStatusLabel(t, "cancelled")}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">{t("purchaseOrders.poDealEligibility")}</span>
          <select
            className={inputCls}
            value={eligibility}
            disabled={!isOwner || savingEligibility}
            onChange={(e) => saveEligibility(e.target.value as "in_transit_or_arrived" | "arrived_only")}
          >
            <option value="in_transit_or_arrived">{t("purchaseOrders.eligibilityInTransitOrArrived")}</option>
            <option value="arrived_only">{t("purchaseOrders.eligibilityArrivedOnly")}</option>
          </select>
        </label>
      </section>

      {isOwner && (
        <section className="rounded-xl border border-app bg-panel p-4">
          <h2 className="mb-3 text-base font-semibold">{t("purchaseOrders.createHeading")}</h2>
          <form className="grid gap-3 md:grid-cols-5" onSubmit={createPo}>
            <label className="space-y-1 text-xs">
              <span className="text-muted">{t("purchaseOrders.supplier")}</span>
              <select
                className={inputCls}
                value={form.supplier_id}
                onChange={(e) => setForm((p) => ({ ...p, supplier_id: e.target.value }))}
              >
                <option value="">{t("purchaseOrders.noSupplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || t("purchaseOrders.unknown")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted">{t("purchaseOrders.market")}</span>
              <select
                className={inputCls}
                value={form.source_market}
                onChange={(e) => setForm((p) => ({ ...p, source_market: e.target.value }))}
              >
                <option value="china">{t("purchaseOrders.marketChina")}</option>
                <option value="dubai">{t("purchaseOrders.marketDubai")}</option>
                <option value="other">{t("purchaseOrders.marketOther")}</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted">{t("purchaseOrders.currency")}</span>
              <select
                className={inputCls}
                value={form.currency}
                onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
              >
                <option value="USD">USD</option>
                <option value="AED">AED</option>
                <option value="DZD">DZD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted">{t("purchaseOrders.eta")}</span>
              <input
                className={inputCls}
                type="date"
                value={form.expected_arrival_date}
                onChange={(e) => setForm((p) => ({ ...p, expected_arrival_date: e.target.value }))}
              />
            </label>
            <label className="space-y-1 text-xs md:col-span-5">
              <span className="text-muted">{t("purchaseOrders.notes")}</span>
              <input
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder={t("purchaseOrders.notesOptionalPlaceholder")}
              />
            </label>
            <div className="md:col-span-5 rounded-lg border border-app/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("purchaseOrders.lineItems")}</h3>
                <button
                  type="button"
                  onClick={addLineItem}
                  className="rounded-md border border-app px-3 py-1 text-xs font-semibold hover:bg-white/70"
                >
                  {t("purchaseOrders.addItem")}
                </button>
              </div>
              <div className="space-y-2">
                {lineItems.map((item, idx) => {
                  const subtotal = Math.max(1, Number(item.quantity || 1)) * Math.max(0, Number(item.unitPrice || 0));
                  return (
                    <div key={item.rowId} className="grid gap-2 rounded-md border border-app/40 p-2 md:grid-cols-12">
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.sourceLabel")}</span>
                          <select
                            className={inputCls}
                            value={item.sourceMode}
                            onChange={(e) => updateLineItem(item.rowId, "sourceMode", e.target.value)}
                          >
                            <option value="manual">{t("purchaseOrders.sourceManual")}</option>
                            <option value="catalog">{t("purchaseOrders.sourceCatalog")}</option>
                          </select>
                        </label>
                      </div>
                      {item.sourceMode === "catalog" && (
                        <div className="md:col-span-3">
                          <label className="space-y-1 text-xs">
                            <span className="text-muted">{t("purchaseOrders.catalogCar")}</span>
                            <select
                              className={inputCls}
                              value={item.catalogId}
                              onChange={(e) => updateLineItem(item.rowId, "catalogId", e.target.value)}
                            >
                              <option value="">{t("purchaseOrders.selectPlaceholder")}</option>
                              {catalogRows.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.brand} {row.model} {row.year || ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.colBrand")}</span>
                          <input className={inputCls} value={item.brand} onChange={(e) => updateLineItem(item.rowId, "brand", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.colModel")}</span>
                          <input className={inputCls} value={item.model} onChange={(e) => updateLineItem(item.rowId, "model", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-1">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.colYear")}</span>
                          <input className={inputCls} value={item.year} onChange={(e) => updateLineItem(item.rowId, "year", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.colColor")}</span>
                          <input className={inputCls} value={item.color} onChange={(e) => updateLineItem(item.rowId, "color", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-1">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.qty")}</span>
                          <input className={inputCls} value={item.quantity} onChange={(e) => updateLineItem(item.rowId, "quantity", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.unitPrice")}</span>
                          <input className={inputCls} value={item.unitPrice} onChange={(e) => updateLineItem(item.rowId, "unitPrice", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.subtotal")}</span>
                          <input className={inputCls} value={fmtMoney(subtotal, form.currency)} readOnly />
                        </label>
                      </div>
                      <div className="md:col-span-4">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">{t("purchaseOrders.notes")}</span>
                        </label>
                      </div>
                      <div className="md:col-span-2 flex items-end">
                        <button
                          type="button"
                          onClick={() => removeLineItem(item.rowId)}
                          className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          {t("purchaseOrders.removeLine")}
                        </button>
                        <span className="ml-2 text-[10px] text-muted">{t("purchaseOrders.itemNumber", { n: idx + 1 })}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="md:col-span-5 rounded-lg border border-app/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("purchaseOrders.initialPaymentsHeading")}</h3>
                <button
                  type="button"
                  onClick={addPaymentRow}
                  className="rounded-md border border-app px-3 py-1 text-xs font-semibold hover:bg-white/70"
                >
                  {t("purchaseOrders.addPayment")}
                </button>
              </div>
              <div className="space-y-2">
                {payments.map((payment, idx) => (
                  <div key={payment.rowId} className="grid gap-2 rounded-md border border-app/40 p-2 md:grid-cols-12">
                    <input className={`${inputCls} md:col-span-2`} type="date" value={payment.date} onChange={(e) => updatePaymentRow(payment.rowId, "date", e.target.value)} />
                    <input className={`${inputCls} md:col-span-2`} placeholder={t("purchaseOrders.placeholderAmount")} value={payment.amount} onChange={(e) => updatePaymentRow(payment.rowId, "amount", e.target.value)} />
                    <select className={`${inputCls} md:col-span-1`} value={payment.currency} onChange={(e) => updatePaymentRow(payment.rowId, "currency", e.target.value)}>
                      <option value="USD">USD</option>
                      <option value="AED">AED</option>
                      <option value="DZD">DZD</option>
                      <option value="EUR">EUR</option>
                    </select>
                    <input className={`${inputCls} md:col-span-2`} placeholder={t("purchaseOrders.placeholderRateSnapshot")} value={payment.rate_snapshot} onChange={(e) => updatePaymentRow(payment.rowId, "rate_snapshot", e.target.value)} />
                    <select
                      required={Number(payment.amount || 0) > 0}
                      className={`${inputCls} md:col-span-2`}
                      value={payment.pocket}
                      onChange={(e) => updatePaymentRow(payment.rowId, "pocket", e.target.value)}
                    >
                      <option value="">{t("purchaseOrders.cashPocketPlaceholder")}</option>
                      {cashPocketOptionsForCurrency(payment.currency).map((opt) => (
                        <option key={opt} value={opt}>
                          {pocketDetailLabel(t, opt)}
                        </option>
                      ))}
                    </select>
                    <input className={`${inputCls} md:col-span-2`} placeholder={t("purchaseOrders.placeholderMethod")} value={payment.method} onChange={(e) => updatePaymentRow(payment.rowId, "method", e.target.value)} />
                    <button type="button" onClick={() => removePaymentRow(payment.rowId)} className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 md:col-span-1">{t("purchaseOrders.removeLine")}</button>
                    <input className={`${inputCls} md:col-span-11`} placeholder={t("purchaseOrders.placeholderNotes")} value={payment.notes} onChange={(e) => updatePaymentRow(payment.rowId, "notes", e.target.value)} />
                    <span className="text-[10px] text-muted md:col-span-1">{t("purchaseOrders.payNumber", { n: idx + 1 })}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="md:col-span-5 rounded-lg border border-app/60 p-3">
              <h3 className="mb-2 text-sm font-semibold">{t("purchaseOrders.orderSummary")}</h3>
              <div className="grid gap-2 md:grid-cols-4">
                <label className="space-y-1 text-xs">
                  <span className="text-muted">{t("purchaseOrders.subtotalLines")}</span>
                  <input className={inputCls} readOnly value={fmtMoney(itemSubtotal, form.currency)} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted">{t("purchaseOrders.shippingEstimateOptional")}</span>
                  <input className={inputCls} value={shippingEstimate} onChange={(e) => setShippingEstimate(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted">{t("purchaseOrders.otherFeesOptional")}</span>
                  <input className={inputCls} value={otherFees} onChange={(e) => setOtherFees(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted">{t("purchaseOrders.grandTotal")}</span>
                  <input className={inputCls} readOnly value={fmtMoney(grandTotal, form.currency)} />
                </label>
              </div>
              <label className="mt-3 inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={createInventoryRows}
                  onChange={(e) => setCreateInventoryRows(e.target.checked)}
                />
                {t("purchaseOrders.inventoryCheckboxHelp")}
              </label>
            </div>
            <div className="md:col-span-5">
              <Button type="submit" variant="primary" size="sm" isDisabled={saving}>
                {saving ? t("purchaseOrders.creatingPo") : t("purchaseOrders.createPoShort")}
              </Button>
            </div>
          </form>
        </section>
      )}

      <section className="responsive-table-wrap rounded-xl border border-app bg-panel">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-left">{t("purchaseOrders.thPo")}</th>
              <th className="px-3 py-2 text-left">{t("purchaseOrders.supplierCol")}</th>
              <th className="px-3 py-2 text-left">{t("purchaseOrders.status")}</th>
              <th className="px-3 py-2 text-right">{t("purchaseOrders.thTotal")}</th>
              <th className="px-3 py-2 text-right">{t("purchaseOrders.paid")}</th>
              <th className="px-3 py-2 text-right">{t("purchaseOrders.owedCol")}</th>
              <th className="px-3 py-2 text-left">{t("purchaseOrders.etaCol")}</th>
              <th className="px-3 py-2 text-left">{t("purchaseOrders.thCreated")}</th>
              {isOwner && <th className="px-3 py-2 text-left">{t("purchaseOrders.actionsCol")}</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-8" colSpan={isOwner ? 9 : 8}>
                  <div className="flex flex-col items-center justify-center gap-2 text-default-500">
                    <Spinner size="md" color="danger" />
                    <span className="text-sm">{t("purchaseOrders.loadingList")}</span>
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={isOwner ? 9 : 8}>
                  {t("purchaseOrders.emptyList")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-app/50">
                  <td className="px-3 py-2">
                    <Link href={`/purchase-orders/${row.id}`} className="text-[var(--color-accent)] hover:underline">
                      {row.po_number || row.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {(row.supplier_id && supplierMap.get(row.supplier_id)) || dash}
                  </td>
                  <td className="px-3 py-2">{poStatusLabel(t, row.status)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.total_cost, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.paid_amount, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.supplier_owed, row.currency)}</td>
                  <td className="px-3 py-2">{fmtDate(row.expected_arrival_date)}</td>
                  <td className="px-3 py-2">{row.created_at ? fmtDate(row.created_at) : dash}</td>
                  {isOwner && (
                    <td className="px-3 py-2">
                      <RowActionsMenu label={t("purchaseOrders.actionsMenuPo")}>
                        <Button type="button" variant="ghost" size="sm" className="justify-start text-xs text-danger" onPress={() => removePo(row.id)}>
                          {t("purchaseOrders.removeLine")}
                        </Button>
                      </RowActionsMenu>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        {rows.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-app/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{t("purchaseOrders.rowsPerPage")}</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-md border border-[#222222] bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span>
                {t("purchaseOrders.paginationRange", {
                  from: formatNumberForLocale(locale, (page - 1) * pageSize + 1, { maximumFractionDigits: 0 }),
                  to: formatNumberForLocale(locale, Math.min(page * pageSize, total), {
                    maximumFractionDigits: 0,
                  }),
                  total: formatNumberForLocale(locale, total, { maximumFractionDigits: 0 }),
                })}
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted">
              {t("purchaseOrders.pageStatus", {
                page: formatNumberForLocale(locale, page, { maximumFractionDigits: 0 }),
                pages: formatNumberForLocale(locale, Math.max(1, Math.ceil(total / pageSize)), {
                  maximumFractionDigits: 0,
                }),
              })}
            </span>
            <Button type="button" size="sm" variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))}>
              {t("purchaseOrders.pagePrevious")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              isDisabled={page >= Math.max(1, Math.ceil(total / pageSize))}
              onPress={() => setPage((p) => Math.min(Math.max(1, Math.ceil(total / pageSize)), p + 1))}
            >
              {t("purchaseOrders.pageNext")}
            </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
