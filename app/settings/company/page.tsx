"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "@heroui/react";
import { PageContainer } from "@/components/ui/page-container";
import { useAuth } from "@/lib/context/AuthContext";
import type { CompanySettings } from "@/lib/contracts/companySettings";

type FormState = Omit<
  CompanySettings,
  "id" | "updated_at" | "updated_by"
>;

const EMPTY_FORM: FormState = {
  fze_license_number: "",
  fze_address: "",
  fze_representative: "",
  fze_position: "",
  auto_license_number: "",
  auto_address: "",
  auto_representative: "",
  auto_position: "",
  fze_phone: "",
  fze_email: "",
  auto_phone: "",
  auto_email: "",
};

const FIELD_ORDER: Array<keyof FormState> = [
  "fze_license_number",
  "fze_address",
  "fze_representative",
  "fze_position",
  "fze_phone",
  "fze_email",
  "auto_license_number",
  "auto_address",
  "auto_representative",
  "auto_position",
  "auto_phone",
  "auto_email",
];

const LABELS: Record<keyof FormState, string> = {
  fze_license_number: "FZE License Number",
  fze_address: "FZE Address",
  fze_representative: "FZE Representative",
  fze_position: "FZE Position",
  fze_phone: "FZE Phone",
  fze_email: "FZE Email",
  auto_license_number: "Auto License Number",
  auto_address: "Auto Address",
  auto_representative: "Auto Representative",
  auto_position: "Auto Position",
  auto_phone: "Auto Phone",
  auto_email: "Auto Email",
};

export default function CompanySettingsPage() {
  const { role, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedByName, setUpdatedByName] = useState<string | null>(null);

  const isOwner = (role || "").toLowerCase() === "owner";
  const missingFields = useMemo(
    () => FIELD_ORDER.filter((k) => !String(form[k] || "").trim()),
    [form]
  );
  const canSave = isOwner && !saving && missingFields.length === 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/company", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load company settings");
      const row = (json.row || {}) as Partial<CompanySettings>;
      setForm({
        fze_license_number: String(row.fze_license_number || ""),
        fze_address: String(row.fze_address || ""),
        fze_representative: String(row.fze_representative || ""),
        fze_position: String(row.fze_position || ""),
        auto_license_number: String(row.auto_license_number || ""),
        auto_address: String(row.auto_address || ""),
        auto_representative: String(row.auto_representative || ""),
        auto_position: String(row.auto_position || ""),
        fze_phone: String(row.fze_phone || ""),
        fze_email: String(row.fze_email || ""),
        auto_phone: String(row.auto_phone || ""),
        auto_email: String(row.auto_email || ""),
      });
      setUpdatedAt((row.updated_at as string | null) || null);
      setUpdatedByName((json.updated_by_name as string | null) || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isOwner) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, isOwner, load]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/settings/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save company settings");
      setSuccess("Company settings saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <PageContainer size="lg">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" color="danger" /> Loading company settings...
        </div>
      </PageContainer>
    );
  }

  if (!isOwner) {
    return (
      <PageContainer size="lg">
        <Alert.Root status="danger">
          <Alert.Content>
            <Alert.Description>Forbidden. Owner role required.</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="lg" className="gap-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-app">Company Settings</h1>
        <p className="text-xs text-muted">
          Last updated by {updatedByName || "—"} on{" "}
          {updatedAt ? new Date(updatedAt).toLocaleString("en-GB") : "—"}
        </p>
      </header>
      {error ? (
        <Alert.Root status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
      {success ? (
        <Alert.Root status="success">
          <Alert.Content>
            <Alert.Description>{success}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
      {missingFields.length > 0 ? (
        <Alert.Root status="warning">
          <Alert.Content>
            <Alert.Description>
              All 12 company fields are required before contract generation.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELD_ORDER.map((key) => (
          <label key={key} className="space-y-1">
            <span className="text-xs font-semibold text-app">
              {LABELS[key]} <span className="text-red-500">*</span>
            </span>
            <input
              value={form[key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
              className={`w-full rounded-md border px-3 py-2 text-sm ${
                !String(form[key] || "").trim() ? "border-red-500" : "border-app"
              } bg-white text-app`}
            />
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="primary" onPress={handleSave} isDisabled={!canSave}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </PageContainer>
  );
}
