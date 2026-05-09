"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@heroui/react";

export type SalesNotesSaveResult = {
  sales_notes: string | null;
  sales_notes_updated_at: string | null;
  sales_notes_updated_by: string | null;
  sales_notes_updated_by_name: string | null;
};

type SalesNotesFieldProps = {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  /** Persist current `value`; return server fields for "Last updated…". */
  onSave: (salesNotes: string) => Promise<SalesNotesSaveResult>;
  lastUpdatedAt: string | null;
  lastUpdatedByName: string | null;
  className?: string;
};

export function SalesNotesField({
  value,
  onChange,
  readOnly,
  onSave,
  lastUpdatedAt,
  lastUpdatedByName,
  className = "",
}: SalesNotesFieldProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleSave = useCallback(async () => {
    if (readOnly || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      setToast("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [onSave, readOnly, saving, value]);

  const metaLine =
    lastUpdatedAt || lastUpdatedByName
      ? `Last updated${lastUpdatedByName ? ` by ${lastUpdatedByName}` : ""}${
          lastUpdatedAt ? ` · ${new Date(lastUpdatedAt).toLocaleString()}` : ""
        }`
      : null;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-app">Sales notes</span>
        {!readOnly ? (
          <Button type="button" size="sm" variant="primary" onPress={() => void handleSave()} isDisabled={saving}>
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="sm" color="danger" />
                Saving…
              </span>
            ) : (
              "Save"
            )}
          </Button>
        ) : null}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={readOnly ? "—" : "Notes for the Algeria sales team…"}
        rows={4}
        className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)] read-only:bg-gray-50 read-only:text-default-600"
      />
      {metaLine ? <p className="text-[11px] text-default-500">{metaLine}</p> : null}
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      {toast ? (
        <p className="text-[11px] font-medium text-emerald-700" role="status">
          {toast}
        </p>
      ) : null}
    </div>
  );
}
