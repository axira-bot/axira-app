"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";
import { normalizeRole } from "@/lib/auth/roles";

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

function formatMoney(amount: number, currency: string) {
  return `${Number(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency || ""}`.trim();
}

export default function PurchaseOrdersPage() {
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
      pocket: "bank",
      method: "bank_transfer",
      notes: "",
    },
  ]);

  const supplierMap = useMemo(() => {
    const m = new Map<string, string>();
    suppliers.forEach((s) => m.set(s.id, s.name || "Unknown"));
    return m;
  }, [suppliers]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    const [poRes, suppRes, settingRes, catalogRes] = await Promise.all([
      fetch(
        `/api/purchase-orders?supplier_id=${encodeURIComponent(supplierFilter)}&status=${encodeURIComponent(statusFilter)}`,
        { cache: "no-store" }
      ),
      supabase.from("suppliers").select("id, name").eq("active", true).order("name", { ascending: true }),
      fetch("/api/purchase-orders/settings", { cache: "no-store" }),
      supabase.from("supplier_catalog").select("id, brand, model, year").eq("active", true).order("brand", { ascending: true }),
    ]);
    const poData = await poRes.json().catch(() => ({}));
    if (!poRes.ok) {
      setError(poData.error || "Failed to load purchase orders");
      setRows([]);
    } else {
      setRows((poData.rows as PurchaseOrder[] | undefined) || []);
    }
    setSuppliers((suppRes.data as Supplier[]) || []);
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
  }, [supplierFilter, statusFilter]);

  const createPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPrivileged) return;
    setSaving(true);
    setError(null);
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
      setError("Please add at least one valid line item.");
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
      setError(data.error || "Failed to create purchase order");
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
        pocket: "bank",
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
      setError(data.error || "Failed to save deal eligibility setting");
    }
  };

  const removePo = async (id: string) => {
    if (!isOwner) return;
    if (!window.confirm("Delete this purchase order? This is blocked if linked inventory cars exist.")) return;
    setError(null);
    const res = await fetch(`/api/purchase-orders/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Failed to delete PO");
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
        pocket: "bank",
        method: "bank_transfer",
        notes: "",
      },
    ]);
  };
  const removePaymentRow = (rowId: string) => {
    setPayments((prev) => (prev.length === 1 ? prev : prev.filter((x) => x.rowId !== rowId)));
  };
  const updatePaymentRow = (rowId: string, field: keyof PoPaymentDraft, value: string) => {
    setPayments((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, [field]: value } : row)));
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
    <main className="space-y-5 p-6 text-app">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Purchase Orders</h1>
          <p className="text-xs text-muted">Bulk procurement, payment tracking, and receive workflow.</p>
        </div>
        {canManageSuppliers ? (
          <Link
            href="/suppliers"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            Add / manage suppliers
          </Link>
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-app bg-panel p-3">
          <p className="text-xs text-muted">Total cost</p>
          <p className="text-lg font-semibold">{formatMoney(stats.total, "USD")}</p>
        </div>
        <div className="rounded-xl border border-app bg-panel p-3">
          <p className="text-xs text-muted">Paid</p>
          <p className="text-lg font-semibold">{formatMoney(stats.paid, "USD")}</p>
        </div>
        <div className="rounded-xl border border-app bg-panel p-3">
          <p className="text-xs text-muted">Supplier owed</p>
          <p className="text-lg font-semibold">{formatMoney(stats.owed, "USD")}</p>
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-app bg-panel p-4 md:grid-cols-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted">Filter by supplier</span>
          <select className={inputCls} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || "Unknown"}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">Status</span>
          <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="ordered">Ordered</option>
            <option value="partial_received">Partial Received</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">PO deal eligibility</span>
          <select
            className={inputCls}
            value={eligibility}
            disabled={!isOwner || savingEligibility}
            onChange={(e) => saveEligibility(e.target.value as "in_transit_or_arrived" | "arrived_only")}
          >
            <option value="in_transit_or_arrived">In Transit or Arrived</option>
            <option value="arrived_only">Arrived Only</option>
          </select>
        </label>
      </section>

      {isOwner && (
        <section className="rounded-xl border border-app bg-panel p-4">
          <h2 className="mb-3 text-base font-semibold">Create Purchase Order</h2>
          <form className="grid gap-3 md:grid-cols-5" onSubmit={createPo}>
            <label className="space-y-1 text-xs">
              <span className="text-muted">Supplier</span>
              <select
                className={inputCls}
                value={form.supplier_id}
                onChange={(e) => setForm((p) => ({ ...p, supplier_id: e.target.value }))}
              >
                <option value="">No supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || "Unknown"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted">Market</span>
              <select
                className={inputCls}
                value={form.source_market}
                onChange={(e) => setForm((p) => ({ ...p, source_market: e.target.value }))}
              >
                <option value="china">China</option>
                <option value="dubai">Dubai</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted">Currency</span>
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
              <span className="text-muted">ETA</span>
              <input
                className={inputCls}
                type="date"
                value={form.expected_arrival_date}
                onChange={(e) => setForm((p) => ({ ...p, expected_arrival_date: e.target.value }))}
              />
            </label>
            <label className="space-y-1 text-xs md:col-span-5">
              <span className="text-muted">Notes</span>
              <input
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </label>
            <div className="md:col-span-5 rounded-lg border border-app/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Line Items</h3>
                <button
                  type="button"
                  onClick={addLineItem}
                  className="rounded-md border border-app px-3 py-1 text-xs font-semibold hover:bg-white/70"
                >
                  + Add item
                </button>
              </div>
              <div className="space-y-2">
                {lineItems.map((item, idx) => {
                  const subtotal = Math.max(1, Number(item.quantity || 1)) * Math.max(0, Number(item.unitPrice || 0));
                  return (
                    <div key={item.rowId} className="grid gap-2 rounded-md border border-app/40 p-2 md:grid-cols-12">
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Source</span>
                          <select
                            className={inputCls}
                            value={item.sourceMode}
                            onChange={(e) => updateLineItem(item.rowId, "sourceMode", e.target.value)}
                          >
                            <option value="manual">Manual</option>
                            <option value="catalog">Catalog</option>
                          </select>
                        </label>
                      </div>
                      {item.sourceMode === "catalog" && (
                        <div className="md:col-span-3">
                          <label className="space-y-1 text-xs">
                            <span className="text-muted">Catalog car</span>
                            <select
                              className={inputCls}
                              value={item.catalogId}
                              onChange={(e) => updateLineItem(item.rowId, "catalogId", e.target.value)}
                            >
                              <option value="">Select</option>
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
                          <span className="text-muted">Brand</span>
                          <input className={inputCls} value={item.brand} onChange={(e) => updateLineItem(item.rowId, "brand", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Model</span>
                          <input className={inputCls} value={item.model} onChange={(e) => updateLineItem(item.rowId, "model", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-1">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Year</span>
                          <input className={inputCls} value={item.year} onChange={(e) => updateLineItem(item.rowId, "year", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Color</span>
                          <input className={inputCls} value={item.color} onChange={(e) => updateLineItem(item.rowId, "color", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-1">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Qty</span>
                          <input className={inputCls} value={item.quantity} onChange={(e) => updateLineItem(item.rowId, "quantity", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Unit price</span>
                          <input className={inputCls} value={item.unitPrice} onChange={(e) => updateLineItem(item.rowId, "unitPrice", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Subtotal</span>
                          <input className={inputCls} value={formatMoney(subtotal, form.currency)} readOnly />
                        </label>
                      </div>
                      <div className="md:col-span-4">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted">Notes</span>
                          <input className={inputCls} value={item.notes} onChange={(e) => updateLineItem(item.rowId, "notes", e.target.value)} />
                        </label>
                      </div>
                      <div className="md:col-span-2 flex items-end">
                        <button
                          type="button"
                          onClick={() => removeLineItem(item.rowId)}
                          className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Remove
                        </button>
                        <span className="ml-2 text-[10px] text-muted">Item #{idx + 1}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="md:col-span-5 rounded-lg border border-app/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Initial Supplier Payments (Optional)</h3>
                <button
                  type="button"
                  onClick={addPaymentRow}
                  className="rounded-md border border-app px-3 py-1 text-xs font-semibold hover:bg-white/70"
                >
                  + Add payment
                </button>
              </div>
              <div className="space-y-2">
                {payments.map((payment, idx) => (
                  <div key={payment.rowId} className="grid gap-2 rounded-md border border-app/40 p-2 md:grid-cols-12">
                    <input className={`${inputCls} md:col-span-2`} type="date" value={payment.date} onChange={(e) => updatePaymentRow(payment.rowId, "date", e.target.value)} />
                    <input className={`${inputCls} md:col-span-2`} placeholder="Amount" value={payment.amount} onChange={(e) => updatePaymentRow(payment.rowId, "amount", e.target.value)} />
                    <select className={`${inputCls} md:col-span-1`} value={payment.currency} onChange={(e) => updatePaymentRow(payment.rowId, "currency", e.target.value)}>
                      <option value="USD">USD</option>
                      <option value="AED">AED</option>
                      <option value="DZD">DZD</option>
                      <option value="EUR">EUR</option>
                    </select>
                    <input className={`${inputCls} md:col-span-2`} placeholder="Rate snapshot" value={payment.rate_snapshot} onChange={(e) => updatePaymentRow(payment.rowId, "rate_snapshot", e.target.value)} />
                    <input className={`${inputCls} md:col-span-2`} placeholder="Pocket" value={payment.pocket} onChange={(e) => updatePaymentRow(payment.rowId, "pocket", e.target.value)} />
                    <input className={`${inputCls} md:col-span-2`} placeholder="Method" value={payment.method} onChange={(e) => updatePaymentRow(payment.rowId, "method", e.target.value)} />
                    <button type="button" onClick={() => removePaymentRow(payment.rowId)} className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 md:col-span-1">Remove</button>
                    <input className={`${inputCls} md:col-span-11`} placeholder="Notes" value={payment.notes} onChange={(e) => updatePaymentRow(payment.rowId, "notes", e.target.value)} />
                    <span className="text-[10px] text-muted md:col-span-1">Pay #{idx + 1}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="md:col-span-5 rounded-lg border border-app/60 p-3">
              <h3 className="mb-2 text-sm font-semibold">Order Summary</h3>
              <div className="grid gap-2 md:grid-cols-4">
                <label className="space-y-1 text-xs">
                  <span className="text-muted">Items subtotal</span>
                  <input className={inputCls} readOnly value={formatMoney(itemSubtotal, form.currency)} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted">Shipping estimate (optional)</span>
                  <input className={inputCls} value={shippingEstimate} onChange={(e) => setShippingEstimate(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted">Other fees (optional)</span>
                  <input className={inputCls} value={otherFees} onChange={(e) => setOtherFees(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted">Grand total</span>
                  <input className={inputCls} readOnly value={formatMoney(grandTotal, form.currency)} />
                </label>
              </div>
              <label className="mt-3 inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={createInventoryRows}
                  onChange={(e) => setCreateInventoryRows(e.target.checked)}
                />
                Generate placeholder inventory entries now (INCOMING / in-transit)
              </label>
            </div>
            <div className="md:col-span-5">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create PO"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="overflow-x-auto rounded-xl border border-app bg-panel">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-left">PO</th>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Owed</th>
              <th className="px-3 py-2 text-left">ETA</th>
              <th className="px-3 py-2 text-left">Created</th>
              {isOwner && <th className="px-3 py-2 text-left">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={isOwner ? 9 : 8}>
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={isOwner ? 9 : 8}>
                  No purchase orders yet.
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
                  <td className="px-3 py-2">{(row.supplier_id && supplierMap.get(row.supplier_id)) || "-"}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.total_cost, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.paid_amount, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.supplier_owed, row.currency)}</td>
                  <td className="px-3 py-2">{row.expected_arrival_date || "-"}</td>
                  <td className="px-3 py-2">{row.created_at ? new Date(row.created_at).toLocaleDateString() : "-"}</td>
                  {isOwner && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removePo(row.id)}
                        className="rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
