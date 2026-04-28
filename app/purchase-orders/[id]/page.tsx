"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/context/AuthContext";

type PurchaseOrder = {
  id: string;
  po_number: string | null;
  status: string;
  currency: string;
  total_cost: number;
  paid_amount: number;
  supplier_owed: number;
  expected_arrival_date: string | null;
  ordered_at: string | null;
  notes: string | null;
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
  aed_equivalent: number | null;
  pocket: string | null;
  method: string | null;
  notes: string | null;
};

type ItemCar = { purchase_order_item_id: string; car_id: string };

const inputCls =
  "w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]";

function money(v: number, c: string) {
  return `${Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c}`;
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { role } = useAuth();
  const isPrivileged = ["owner", "manager", "admin", "super_admin"].includes((role || "").toLowerCase());
  const [row, setRow] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [itemCars, setItemCars] = useState<ItemCar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [receiving, setReceiving] = useState(false);
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
    pocket: "bank",
    method: "bank_transfer",
    notes: "",
  });

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
      setError(data.error || "Failed to load PO");
      setRow(null);
      setItems([]);
      setPayments([]);
      setItemCars([]);
    } else {
      setRow((data.row as PurchaseOrder) || null);
      setItems((data.items as Item[]) || []);
      setPayments((data.payments as Payment[]) || []);
      setItemCars((data.itemCars as ItemCar[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !isPrivileged) return;
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
      setError(data.error || "Failed to add item");
      return;
    }
    setItemForm({ brand: "", model: "", year: "", color: "", vin: "", quantity: "1", unit_cost: "0", notes: "" });
    load();
  };

  const addPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !isPrivileged) return;
    setSavingPayment(true);
    const res = await fetch(`/api/purchase-orders/${id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: paymentForm.date,
        amount: Number(paymentForm.amount || 0),
        currency: paymentForm.currency,
        rate_snapshot: paymentForm.rate_snapshot ? Number(paymentForm.rate_snapshot) : null,
        pocket: paymentForm.pocket,
        method: paymentForm.method,
        notes: paymentForm.notes || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingPayment(false);
    if (!res.ok) {
      setError(data.error || "Failed to add payment");
      return;
    }
    setPaymentForm((p) => ({ ...p, amount: "", rate_snapshot: "", notes: "" }));
    load();
  };

  const receive = async (mode: "arrived" | "available") => {
    if (!id || !isPrivileged) return;
    setReceiving(true);
    const res = await fetch(`/api/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json().catch(() => ({}));
    setReceiving(false);
    if (!res.ok) {
      setError(data.error || "Failed to receive");
      return;
    }
    load();
  };

  return (
    <main className="space-y-5 p-6 text-app">
      {loading ? (
        <p className="text-sm text-muted">Loading purchase order...</p>
      ) : !row ? (
        <p className="text-sm text-red-600">{error || "PO not found."}</p>
      ) : (
        <>
          <section className="rounded-xl border border-app bg-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{row.po_number || row.id}</h1>
                <p className="text-xs text-muted">
                  Status: {row.status} · Ordered: {row.ordered_at || "-"} · ETA: {row.expected_arrival_date || "-"}
                </p>
              </div>
              <div className="text-right text-sm">
                <p>Total: {money(row.total_cost, row.currency)}</p>
                <p>Paid: {money(row.paid_amount, row.currency)}</p>
                <p className={row.supplier_owed <= 0 ? "text-emerald-600 font-semibold" : "text-amber-700 font-semibold"}>
                  Owed: {money(row.supplier_owed, row.currency)}
                </p>
              </div>
            </div>
            {row.notes && <p className="mt-3 text-sm text-muted">{row.notes}</p>}
          </section>

          <section className="rounded-xl border border-app bg-panel p-4">
            <h2 className="mb-3 text-base font-semibold">Line Items</h2>
            {isPrivileged && (
              <form className="mb-4 grid gap-2 md:grid-cols-8" onSubmit={addItem}>
                <input className={inputCls} placeholder="Brand" value={itemForm.brand} onChange={(e) => setItemForm((p) => ({ ...p, brand: e.target.value }))} />
                <input className={inputCls} placeholder="Model" value={itemForm.model} onChange={(e) => setItemForm((p) => ({ ...p, model: e.target.value }))} />
                <input className={inputCls} placeholder="Year" value={itemForm.year} onChange={(e) => setItemForm((p) => ({ ...p, year: e.target.value }))} />
                <input className={inputCls} placeholder="Color" value={itemForm.color} onChange={(e) => setItemForm((p) => ({ ...p, color: e.target.value }))} />
                <input className={inputCls} placeholder="VIN (optional)" value={itemForm.vin} onChange={(e) => setItemForm((p) => ({ ...p, vin: e.target.value }))} />
                <input className={inputCls} placeholder="Qty" value={itemForm.quantity} onChange={(e) => setItemForm((p) => ({ ...p, quantity: e.target.value }))} />
                <input className={inputCls} placeholder="Unit cost" value={itemForm.unit_cost} onChange={(e) => setItemForm((p) => ({ ...p, unit_cost: e.target.value }))} />
                <button
                  type="submit"
                  disabled={savingItem}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingItem ? "Adding..." : "Add item"}
                </button>
                <input className={`${inputCls} md:col-span-8`} placeholder="Notes" value={itemForm.notes} onChange={(e) => setItemForm((p) => ({ ...p, notes: e.target.value }))} />
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-2 py-2 text-left">Car</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2 text-left">Item status</th>
                    <th className="px-2 py-2 text-right">Generated cars</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-app/50">
                      <td className="px-2 py-2">
                        {it.brand} {it.model} {it.year || ""} {it.color || ""}
                        {it.vin ? <div className="text-[11px] text-muted">VIN: {it.vin}</div> : null}
                      </td>
                      <td className="px-2 py-2 text-right">{it.quantity}</td>
                      <td className="px-2 py-2 text-right">{money(it.unit_cost, row.currency)}</td>
                      <td className="px-2 py-2 text-right">{money(it.total_cost, row.currency)}</td>
                      <td className="px-2 py-2">{it.inventory_status}</td>
                      <td className="px-2 py-2 text-right">{carsPerItem.get(it.id) || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-app bg-panel p-4">
            <h2 className="mb-3 text-base font-semibold">Payment Ledger</h2>
            {isPrivileged && (
              <form className="mb-4 grid gap-2 md:grid-cols-7" onSubmit={addPayment}>
                <input className={inputCls} type="date" value={paymentForm.date} onChange={(e) => setPaymentForm((p) => ({ ...p, date: e.target.value }))} />
                <input className={inputCls} placeholder="Amount" value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} />
                <select className={inputCls} value={paymentForm.currency} onChange={(e) => setPaymentForm((p) => ({ ...p, currency: e.target.value }))}>
                  <option value="USD">USD</option>
                  <option value="AED">AED</option>
                  <option value="DZD">DZD</option>
                  <option value="EUR">EUR</option>
                </select>
                <input className={inputCls} placeholder="Rate snapshot" value={paymentForm.rate_snapshot} onChange={(e) => setPaymentForm((p) => ({ ...p, rate_snapshot: e.target.value }))} />
                <input className={inputCls} placeholder="Pocket" value={paymentForm.pocket} onChange={(e) => setPaymentForm((p) => ({ ...p, pocket: e.target.value }))} />
                <input className={inputCls} placeholder="Method" value={paymentForm.method} onChange={(e) => setPaymentForm((p) => ({ ...p, method: e.target.value }))} />
                <button
                  type="submit"
                  disabled={savingPayment}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingPayment ? "Saving..." : "Add payment"}
                </button>
                <input className={`${inputCls} md:col-span-7`} placeholder="Notes" value={paymentForm.notes} onChange={(e) => setPaymentForm((p) => ({ ...p, notes: e.target.value }))} />
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2 text-right">AED eq.</th>
                    <th className="px-2 py-2 text-left">Pocket</th>
                    <th className="px-2 py-2 text-left">Method</th>
                    <th className="px-2 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-app/50">
                      <td className="px-2 py-2">{p.date || "-"}</td>
                      <td className="px-2 py-2 text-right">{money(p.amount, p.currency)}</td>
                      <td className="px-2 py-2 text-right">{money(p.aed_equivalent || 0, "AED")}</td>
                      <td className="px-2 py-2">{p.pocket || "-"}</td>
                      <td className="px-2 py-2">{p.method || "-"}</td>
                      <td className="px-2 py-2">{p.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {isPrivileged && (
            <section className="rounded-xl border border-app bg-panel p-4">
              <h2 className="mb-3 text-base font-semibold">Receive Workflow</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={receiving}
                  onClick={() => receive("arrived")}
                  className="rounded-md border border-app px-4 py-2 text-sm hover:bg-white/70 disabled:opacity-50"
                >
                  Mark Arrived
                </button>
                <button
                  type="button"
                  disabled={receiving}
                  onClick={() => receive("available")}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Mark Available
                </button>
              </div>
            </section>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </main>
  );
}
