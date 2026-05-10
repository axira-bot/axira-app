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
import { useI18n } from "@/lib/context/I18nContext";
import { normalizeRole } from "@/lib/auth/roles";
import { PaginatedTable } from "@/components/ui/paginated-table";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

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
  const { t } = useI18n();
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
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
    const res = await fetch(`/api/suppliers?page=${page}&pageSize=${pageSize}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error || t("suppliers.loadFailed"));
      setRows([]);
      return;
    }
    setRows((data.rows as Supplier[]) ?? []);
    setTotal(Number(data.total || 0));
  }, [canAccess, page, pageSize, t]);

  useEffect(() => {
    load();
  }, [load]);

  const createSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAccess) return;
    const name = form.name.trim();
    if (!name) {
      setError(t("suppliers.nameRequired"));
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
      setError(data.error || t("suppliers.createFailed"));
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
      setError(data.error || t("suppliers.updateFailed"));
      return;
    }
    load();
  };

  if (!canAccess) {
    return (
      <main className="min-h-full p-6 text-foreground" style={{ background: "var(--color-bg)" }}>
        <Card.Root className="max-w-md border border-default-200 shadow-sm">
          <Card.Content className="space-y-3">
            <Text className="text-sm text-default-600">{t("suppliers.noAccess")}</Text>
            <Link
              href="/dashboard"
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-default-200 bg-transparent px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10"
            >
              {t("common.backToDashboard")}
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
          <h1 className="text-2xl font-bold">{t("suppliers.title")}</h1>
          <p className="text-xs text-default-600">
            {t("suppliers.blurb")}{" "}
            <Link href="/purchase-orders" className="text-danger hover:underline">
              {t("suppliers.purchaseOrdersLink")}
            </Link>
            .
          </p>
        </div>
        <Link
          href="/purchase-orders"
          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-default-200 bg-content1 px-3 py-1.5 text-sm font-semibold text-default-700 hover:bg-default-100"
        >
          {t("suppliers.openPurchaseOrders")}
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
          <h2 className="text-base font-semibold">{t("suppliers.addSupplierHeading")}</h2>
          <form className="grid gap-3 md:grid-cols-6" onSubmit={createSupplier}>
            <TextField
              name="name"
              value={form.name}
              onChange={(v) => setForm((p) => ({ ...p, name: v }))}
              isRequired
              className="md:col-span-2"
            >
              <Label className="text-xs text-default-500">{t("suppliers.name")}</Label>
              <Input className="text-sm" placeholder={t("suppliers.namePlaceholder")} />
            </TextField>
            <TextField
              name="country"
              value={form.country}
              onChange={(v) => setForm((p) => ({ ...p, country: v }))}
              className="md:col-span-1"
            >
              <Label className="text-xs text-default-500">{t("suppliers.country")}</Label>
              <Input className="text-sm" placeholder={t("suppliers.countryPlaceholder")} />
            </TextField>
            <div className="flex min-w-0 flex-col gap-1 md:col-span-1">
              <Label className="text-xs text-default-500">{t("suppliers.defaultCurrency")}</Label>
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
              <Label className="text-xs text-default-500">{t("suppliers.contactName")}</Label>
              <Input className="text-sm" />
            </TextField>
            <TextField
              name="contact_phone"
              value={form.contact_phone}
              onChange={(v) => setForm((p) => ({ ...p, contact_phone: v }))}
              className="md:col-span-1"
            >
              <Label className="text-xs text-default-500">{t("suppliers.contactPhone")}</Label>
              <Input className="text-sm" />
            </TextField>
            <div className="md:col-span-6">
              <Button type="submit" variant="primary" size="sm" isDisabled={saving}>
                {saving ? t("dashboard.saving") : t("suppliers.addSupplier")}
              </Button>
            </div>
          </form>
        </Card.Content>
      </Card.Root>

      <Card.Root className="overflow-hidden border border-default-200 shadow-sm">
        <Card.Content className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-default-500">
              <Spinner size="md" color="danger" />
              <span className="text-sm">{t("common.loadingEllipsis")}</span>
            </div>
          ) : (
            <PaginatedTable
              rows={rows}
              rowKey={(row) => row.id}
              pageSize={pageSize}
              page={page}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              emptyContent={t("suppliers.emptyTable")}
              columns={[
                { key: "name", label: t("suppliers.name"), render: (row) => <span className="font-medium">{row.name}</span> },
                { key: "country", label: t("suppliers.country"), render: (row) => row.country || t("common.emiDash") },
                { key: "currency", label: t("suppliers.columnCurrency"), render: (row) => row.default_currency || t("common.emiDash") },
                { key: "contact", label: t("suppliers.columnContact"), render: (row) => [row.contact_name, row.contact_phone].filter(Boolean).join(" · ") || t("common.emiDash") },
                { key: "active", label: t("suppliers.columnActive"), render: (row) => (row.active ? t("common.yes") : t("common.no")) },
                {
                  key: "actions",
                  label: t("inventory.actions"),
                  render: (row) => (
                    <RowActionsMenu label={t("suppliers.supplierActions")}>
                      <Button type="button" variant="ghost" size="sm" className="justify-start text-xs" onPress={() => toggleActive(row)}>
                        {row.active ? t("suppliers.deactivate") : t("suppliers.activate")}
                      </Button>
                    </RowActionsMenu>
                  ),
                },
              ]}
            />
          )}
        </Card.Content>
      </Card.Root>
    </main>
  );
}
