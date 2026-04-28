"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";

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

const inputCls =
  "w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]";

function formatMoney(amount: number, currency: string) {
  return `${Number(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency || ""}`.trim();
}

export default function PurchaseOrdersPage() {
  const { role } = useAuth();
  const isPrivileged = ["owner", "manager", "admin", "super_admin"].includes((role || "").toLowerCase());
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
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

  const supplierMap = useMemo(() => {
    const m = new Map<string, string>();
    suppliers.forEach((s) => m.set(s.id, s.name || "Unknown"));
    return m;
  }, [suppliers]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    const [poRes, suppRes, settingRes] = await Promise.all([
      fetch(
        `/api/purchase-orders?supplier_id=${encodeURIComponent(supplierFilter)}&status=${encodeURIComponent(statusFilter)}`,
        { cache: "no-store" }
      ),
      supabase.from("suppliers").select("id, name").eq("active", true).order("name", { ascending: true }),
      fetch("/api/purchase-orders/settings", { cache: "no-store" }),
    ]);
    const poData = await poRes.json().catch(() => ({}));
    if (!poRes.ok) {
      setError(poData.error || "Failed to load purchase orders");
      setRows([]);
    } else {
      setRows((poData.rows as PurchaseOrder[] | undefined) || []);
    }
    setSuppliers((suppRes.data as Supplier[]) || []);
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
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Failed to create purchase order");
      return;
    }
    setForm({ supplier_id: "", source_market: "china", currency: "USD", expected_arrival_date: "", notes: "" });
    fetchAll();
  };

  const saveEligibility = async (nextValue: "in_transit_or_arrived" | "arrived_only") => {
    if (!isPrivileged) return;
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

  return (
    <main className="space-y-5 p-6 text-app">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Purchase Orders</h1>
          <p className="text-xs text-muted">Bulk procurement, payment tracking, and receive workflow.</p>
        </div>
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
            disabled={!isPrivileged || savingEligibility}
            onChange={(e) => saveEligibility(e.target.value as "in_transit_or_arrived" | "arrived_only")}
          >
            <option value="in_transit_or_arrived">In Transit or Arrived</option>
            <option value="arrived_only">Arrived Only</option>
          </select>
        </label>
      </section>

      {isPrivileged && (
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={8}>
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={8}>
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
