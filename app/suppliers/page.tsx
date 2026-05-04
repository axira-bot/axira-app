"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Label,
  Spinner,
  Text,
  TextField,
} from "@heroui/react";
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
      <main className="min-h-full p-6 text-foreground" style={{ background: "var(--color-bg)" }}>
        <Card.Root className="max-w-md border border-default-200 shadow-sm">
          <Card.Content className="space-y-3">
            <Text className="text-sm text-default-600">You do not have access to manage suppliers.</Text>
            <Link
              href="/dashboard"
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-default-200 bg-transparent px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10"
            >
              Back to dashboard
            </Link>
          </Card.Content>
        </Card.Root>
      </main>
    );
  }

  return (
    <main className="min-h-full space-y-6 p-6 text-foreground" style={{ background: "var(--color-bg)" }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-xs text-default-600">
            Add suppliers here. Active suppliers appear in{" "}
            <Link href="/purchase-orders" className="text-danger hover:underline">
              Purchase Orders
            </Link>
            .
          </p>
        </div>
        <Link
          href="/purchase-orders"
          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-default-200 bg-content1 px-3 py-1.5 text-sm font-semibold text-default-700 hover:bg-default-100"
        >
          Open Purchase Orders
        </Link>
      </div>

      {error ? (
        <Alert.Root status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      <Card.Root className="border border-default-200 shadow-sm">
        <Card.Content className="space-y-4">
          <h2 className="text-base font-semibold">Add supplier</h2>
          <form className="grid gap-3 md:grid-cols-6" onSubmit={createSupplier}>
            <TextField
              name="name"
              value={form.name}
              onChange={(v) => setForm((p) => ({ ...p, name: v }))}
              isRequired
              className="md:col-span-2"
            >
              <Label className="text-xs text-default-500">Name</Label>
              <Input className="text-sm" placeholder="e.g. Eric Trading" />
            </TextField>
            <TextField
              name="country"
              value={form.country}
              onChange={(v) => setForm((p) => ({ ...p, country: v }))}
              className="md:col-span-1"
            >
              <Label className="text-xs text-default-500">Country</Label>
              <Input className="text-sm" placeholder="China / UAE" />
            </TextField>
            <div className="flex min-w-0 flex-col gap-1 md:col-span-1">
              <Label className="text-xs text-default-500">Default currency</Label>
              <select
                value={form.default_currency}
                onChange={(e) => setForm((p) => ({ ...p, default_currency: e.target.value as "USD" | "AED" }))}
                className="rounded-lg border border-default-200 bg-content1 px-3 py-2 text-sm outline-none focus:border-danger"
              >
                <option value="USD">USD</option>
                <option value="AED">AED</option>
              </select>
            </div>
            <TextField
              name="contact_name"
              value={form.contact_name}
              onChange={(v) => setForm((p) => ({ ...p, contact_name: v }))}
              className="md:col-span-1"
            >
              <Label className="text-xs text-default-500">Contact name</Label>
              <Input className="text-sm" />
            </TextField>
            <TextField
              name="contact_phone"
              value={form.contact_phone}
              onChange={(v) => setForm((p) => ({ ...p, contact_phone: v }))}
              className="md:col-span-1"
            >
              <Label className="text-xs text-default-500">Contact phone</Label>
              <Input className="text-sm" />
            </TextField>
            <div className="md:col-span-6">
              <Button type="submit" variant="primary" size="sm" isDisabled={saving}>
                {saving ? "Saving…" : "Add supplier"}
              </Button>
            </div>
          </form>
        </Card.Content>
      </Card.Root>

      <Card.Root className="overflow-hidden border border-default-200 shadow-sm">
        <Card.Content className="p-0">
          <table className="min-w-full text-sm">
          <thead className="bg-default-50 text-xs uppercase text-default-500">
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
                <td className="px-3 py-8" colSpan={6}>
                  <div className="flex flex-col items-center justify-center gap-2 text-default-500">
                    <Spinner size="md" color="danger" />
                    <span className="text-sm">Loading…</span>
                  </div>
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
                    <Button type="button" variant="outline" size="sm" onPress={() => toggleActive(r)}>
                      {r.active ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </Card.Content>
      </Card.Root>
    </main>
  );
}
