"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { normalizeRole } from "@/lib/auth/roles";

type Supplier = {
  id: string;
  name: string;
  country: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  default_currency: string | null;
  active: boolean;
  created_at: string | null;
};

const inputCls =
  "w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]";

export default function SuppliersPage() {
  const { user, profile, permissions } = useAuth();
  const effectiveRole = useMemo(() => {
    const metaRole = (user?.app_metadata as { role?: string } | undefined)?.role;
    return normalizeRole(profile?.role ?? metaRole ?? "");
  }, [user, profile]);
  const canAccess = Boolean(
    permissions.suppliers ||
      ["owner", "admin", "super_admin", "manager"].includes(effectiveRole)
  );
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    country: "",
    contact_name: "",
    contact_phone: "",
    default_currency: "USD" as "USD" | "AED",
  });

  const load = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/suppliers", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Failed to load suppliers");
      setRows([]);
      return;
    }
    setRows((data.rows as Supplier[]) ?? []);
  }, [canAccess]);

  useEffect(() => {
    load();
  }, [load]);

  const createSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAccess) return;
    const name = form.name.trim();
    if (!name) {
      setError("Supplier name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        country: form.country.trim() || null,
        contact_name: form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        default_currency: form.default_currency,
        active: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Failed to create supplier");
      return;
    }
    setForm({ name: "", country: "", contact_name: "", contact_phone: "", default_currency: "USD" });
    load();
  };

  const toggleActive = async (row: Supplier) => {
    if (!canAccess) return;
    setError(null);
    const res = await fetch("/api/suppliers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, active: !row.active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Failed to update supplier");
      return;
    }
    load();
  };

  if (!canAccess) {
    return (
      <main className="p-6 text-app">
        <p className="text-sm text-muted">You do not have access to manage suppliers.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-[var(--color-accent)] hover:underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="space-y-6 p-6 text-app">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-xs text-muted">
            Add suppliers here. Active suppliers appear in{" "}
            <Link href="/purchase-orders" className="text-[var(--color-accent)] hover:underline">
              Purchase Orders
            </Link>
            .
          </p>
        </div>
        <Link
          href="/purchase-orders"
          className="rounded-md border border-app bg-panel px-4 py-2 text-sm font-semibold hover:bg-white/80"
        >
          Open Purchase Orders
        </Link>
      </div>

      <section className="rounded-xl border border-app bg-panel p-4">
        <h2 className="mb-3 text-base font-semibold">Add supplier</h2>
        <form className="grid gap-3 md:grid-cols-6" onSubmit={createSupplier}>
          <label className="space-y-1 text-xs md:col-span-2">
            <span className="text-muted">Name *</span>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Eric Trading"
              required
            />
          </label>
          <label className="space-y-1 text-xs md:col-span-1">
            <span className="text-muted">Country</span>
            <input
              className={inputCls}
              value={form.country}
              onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
              placeholder="China / UAE"
            />
          </label>
          <label className="space-y-1 text-xs md:col-span-1">
            <span className="text-muted">Default currency</span>
            <select
              className={inputCls}
              value={form.default_currency}
              onChange={(e) => setForm((p) => ({ ...p, default_currency: e.target.value as "USD" | "AED" }))}
            >
              <option value="USD">USD</option>
              <option value="AED">AED</option>
            </select>
          </label>
          <label className="space-y-1 text-xs md:col-span-1">
            <span className="text-muted">Contact name</span>
            <input
              className={inputCls}
              value={form.contact_name}
              onChange={(e) => setForm((p) => ({ ...p, contact_name: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-xs md:col-span-1">
            <span className="text-muted">Contact phone</span>
            <input
              className={inputCls}
              value={form.contact_phone}
              onChange={(e) => setForm((p) => ({ ...p, contact_phone: e.target.value }))}
            />
          </label>
          <div className="md:col-span-6">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add supplier"}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-x-auto rounded-xl border border-app bg-panel">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Country</th>
              <th className="px-3 py-2 text-left">Currency</th>
              <th className="px-3 py-2 text-left">Contact</th>
              <th className="px-3 py-2 text-left">Active</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={6}>
                  No suppliers yet. Add one above.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-app/50">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">{r.country || "—"}</td>
                  <td className="px-3 py-2">{r.default_currency || "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {[r.contact_name, r.contact_phone].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2">{r.active ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleActive(r)}
                      className="rounded-md border border-app px-3 py-1 text-xs font-semibold hover:bg-white/70"
                    >
                      {r.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
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
