"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Spinner } from "@heroui/react";
import { useAuth } from "@/lib/context/AuthContext";
import { hasFeature } from "@/lib/auth/permissions";
import type { FeatureKey, FeaturePermissions } from "@/lib/auth/featureKeys";
import { PageContainer } from "@/components/ui/page-container";

type CatalogRow = {
  id: string;
  brand: string;
  model: string;
  year: number | null;
  color_options: string[] | null;
  trim: string | null;
  supplier_id: string | null;
  supplier_reference: string | null;
  sale_price_dzd: number;
  lead_time_days: number;
  deposit_amount_dzd: number;
  photos: string[] | null;
  internal_note: string | null;
  cost_estimate_dzd: number | null;
  margin_note: string | null;
  buyer_responsibilities_note: string | null;
  active: boolean;
  updated_at?: string;
};

const emptyForm = () => ({
  brand: "",
  model: "",
  year: "",
  colorOptions: "",
  trim: "",
  supplierReference: "",
  salePriceDzd: "",
  leadTimeDays: "",
  depositDzd: "",
  photosText: "",
  internalNote: "",
  costEstimateDzd: "",
  marginNote: "",
  buyerRespNote: "",
  active: true,
});

type FormState = ReturnType<typeof emptyForm>;

function formFromRow(r: CatalogRow): FormState {
  return {
    brand: r.brand || "",
    model: r.model || "",
    year: r.year != null ? String(r.year) : "",
    colorOptions: (r.color_options || []).join(", "),
    trim: r.trim || "",
    supplierReference: r.supplier_reference || "",
    salePriceDzd: String(r.sale_price_dzd ?? ""),
    leadTimeDays: String(r.lead_time_days ?? ""),
    depositDzd: String(r.deposit_amount_dzd ?? ""),
    photosText: (r.photos || []).join("\n"),
    internalNote: r.internal_note || "",
    costEstimateDzd: r.cost_estimate_dzd != null ? String(r.cost_estimate_dzd) : "",
    marginNote: r.margin_note || "",
    buyerRespNote: r.buyer_responsibilities_note || "",
    active: r.active !== false,
  };
}

function buildPayload(f: FormState, forCreate: boolean) {
  const colors = f.colorOptions
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const photos = f.photosText
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const base = {
    brand: f.brand.trim(),
    model: f.model.trim(),
    year: f.year.trim() ? Number(f.year) : null,
    color_options: colors,
    trim: f.trim.trim() || null,
    supplier_reference: f.supplierReference.trim() || null,
    sale_price_dzd: Number(f.salePriceDzd),
    lead_time_days: Number(f.leadTimeDays),
    deposit_amount_dzd: Number(f.depositDzd),
    photos,
    internal_note: f.internalNote.trim() || null,
    cost_estimate_dzd: f.costEstimateDzd.trim() ? Number(f.costEstimateDzd) : null,
    margin_note: f.marginNote.trim() || null,
    buyer_responsibilities_note: f.buyerRespNote.trim() || null,
    active: f.active,
  };
  if (forCreate) return base;
  return base;
}

const inputCls =
  "mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]";
const labelCls = "block text-xs font-medium text-default-600";

export default function SalesCatalogAdminPage() {
  const { permissions, loading: authLoading } = useAuth();
  const canAccess = hasFeature(permissions as FeaturePermissions, "sales_catalog_admin" as FeatureKey);

  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((prev) => ({ ...prev, [k]: v }));

  const load = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/sales-catalog", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Failed to load catalog");
      return;
    }
    setRows((data.rows as CatalogRow[]) || []);
  }, [canAccess]);

  useEffect(() => {
    if (authLoading) return;
    if (!canAccess) return;
    void load();
  }, [authLoading, canAccess, load]);

  const openNew = () => {
    setError(null);
    setEditingId(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (r: CatalogRow) => {
    setError(null);
    setEditingId(r.id);
    setForm(formFromRow(r));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const save = async () => {
    if (!form.brand.trim() || !form.model.trim()) {
      setError("Brand and model are required.");
      return;
    }
    const sale = Number(form.salePriceDzd);
    const lead = Number(form.leadTimeDays);
    const dep = Number(form.depositDzd);
    if (!Number.isFinite(sale) || sale < 0) {
      setError("Invalid sale price (DZD).");
      return;
    }
    if (!Number.isFinite(lead) || lead < 0) {
      setError("Invalid lead time (days).");
      return;
    }
    if (!Number.isFinite(dep) || dep < 0) {
      setError("Invalid deposit (DZD).");
      return;
    }

    setSaving(true);
    setError(null);
    const payload = buildPayload(form, !editingId);
    const res = editingId
      ? await fetch(`/api/sales-catalog/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/sales-catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Save failed");
      return;
    }
    closeModal();
    await load();
  };

  const toggleActive = async (r: CatalogRow) => {
    setError(null);
    const res = await fetch(`/api/sales-catalog/${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Update failed");
      return;
    }
    await load();
  };

  const remove = async (r: CatalogRow) => {
    if (!window.confirm(`Delete catalog entry ${r.brand} ${r.model}?`)) return;
    setError(null);
    const res = await fetch(`/api/sales-catalog/${encodeURIComponent(r.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Delete failed");
      return;
    }
    await load();
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8">
        <Spinner color="danger" />
        <span className="text-sm text-default-500">Loading…</span>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <main className="p-6">
        <Alert.Root status="warning">
          <Alert.Content>
            <Alert.Title>Owner only</Alert.Title>
            <Alert.Description>Only owners and admins can manage the order-on-demand catalog.</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </main>
    );
  }

  return (
    <main className="min-h-full" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="lg" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Sales catalog (order on demand)</h1>
          <p className="mt-1 max-w-2xl text-sm text-default-500">
            Owner-priced Algeria list entries. Active rows appear on the sales list “Order on demand” tab for the team.
          </p>
        </div>
        <Button type="button" variant="primary" size="sm" onPress={openNew}>
          New entry
        </Button>
      </div>

      {error ? (
        <Alert.Root status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner color="danger" />
        </div>
      ) : (
        <div className="responsive-table-wrap rounded-xl border border-app bg-panel">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-app bg-black/[0.02] text-xs uppercase text-default-500">
              <tr>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Price (DZD)</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Deposit</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-default-500">
                    No catalog entries yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-app last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {r.brand} {r.model}
                        {r.year != null ? ` · ${r.year}` : ""}
                      </div>
                      {r.trim ? <div className="text-xs text-default-500">{r.trim}</div> : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{Number(r.sale_price_dzd).toLocaleString()}</td>
                    <td className="px-3 py-2">{r.lead_time_days}d</td>
                    <td className="px-3 py-2 tabular-nums">{Number(r.deposit_amount_dzd).toLocaleString()}</td>
                    <td className="px-3 py-2">{r.active ? "Yes" : "No"}</td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <Button type="button" size="sm" variant="ghost" onPress={() => openEdit(r)}>
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="outline" onPress={() => void toggleActive(r)}>
                        {r.active ? "Hide" : "Show"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="text-danger" onPress={() => void remove(r)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close" onClick={closeModal} />
          <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl border border-app bg-panel p-5 shadow-xl sm:rounded-xl">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{editingId ? "Edit entry" : "New catalog entry"}</h2>
              <Button type="button" size="sm" variant="ghost" onPress={closeModal}>
                Close
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                Brand *
                <input className={inputCls} value={form.brand} onChange={(e) => update("brand", e.target.value)} />
              </label>
              <label className={labelCls}>
                Model *
                <input className={inputCls} value={form.model} onChange={(e) => update("model", e.target.value)} />
              </label>
              <label className={labelCls}>
                Year
                <input className={inputCls} type="number" value={form.year} onChange={(e) => update("year", e.target.value)} />
              </label>
              <label className={labelCls}>
                Trim
                <input className={inputCls} value={form.trim} onChange={(e) => update("trim", e.target.value)} />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Color options (comma-separated)
                <input className={inputCls} value={form.colorOptions} onChange={(e) => update("colorOptions", e.target.value)} />
              </label>
              <label className={labelCls}>
                Sale price (DZD) *
                <input className={inputCls} type="number" min={0} value={form.salePriceDzd} onChange={(e) => update("salePriceDzd", e.target.value)} />
              </label>
              <label className={labelCls}>
                Lead time (days) *
                <input className={inputCls} type="number" min={0} value={form.leadTimeDays} onChange={(e) => update("leadTimeDays", e.target.value)} />
              </label>
              <label className={labelCls}>
                Deposit (DZD) *
                <input className={inputCls} type="number" min={0} value={form.depositDzd} onChange={(e) => update("depositDzd", e.target.value)} />
              </label>
              <label className={labelCls}>
                Supplier reference
                <input className={inputCls} value={form.supplierReference} onChange={(e) => update("supplierReference", e.target.value)} />
              </label>
              <label className={labelCls}>
                Cost estimate (DZD)
                <input className={inputCls} type="number" min={0} value={form.costEstimateDzd} onChange={(e) => update("costEstimateDzd", e.target.value)} />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Margin note
                <input className={inputCls} value={form.marginNote} onChange={(e) => update("marginNote", e.target.value)} />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Internal note
                <textarea className={`${inputCls} resize-none`} rows={2} value={form.internalNote} onChange={(e) => update("internalNote", e.target.value)} />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Buyer responsibilities (optional override)
                <textarea className={`${inputCls} resize-none`} rows={2} value={form.buyerRespNote} onChange={(e) => update("buyerRespNote", e.target.value)} />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Photo URLs (one per line)
                <textarea className={`${inputCls} resize-none font-mono text-xs`} rows={4} value={form.photosText} onChange={(e) => update("photosText", e.target.value)} />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => update("active", e.target.checked)} className="accent-[var(--color-accent)]" />
                Active (visible on sales list)
              </label>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onPress={closeModal} isDisabled={saving}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="sm" onPress={() => void save()} isDisabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      </PageContainer>
    </main>
  );
}
