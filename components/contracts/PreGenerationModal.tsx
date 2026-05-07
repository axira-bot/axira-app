"use client";

import { useMemo, useState } from "react";
import { Button } from "@heroui/react";
import {
  MODAL_FIELDS,
  sectionsForMode,
  type DocumentMode,
  type ModalFormValues,
  type PrefillMeta,
} from "@/lib/contracts/modalFields";

type Props = {
  open: boolean;
  mode: DocumentMode;
  meta: PrefillMeta;
  values: ModalFormValues;
  errors: Partial<Record<keyof ModalFormValues, string>>;
  onClose: () => void;
  onChange: (key: keyof ModalFormValues, value: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  canGenerate: boolean;
};

export default function PreGenerationModal(props: Props) {
  const { open, mode, meta, values, errors, onClose, onChange, onGenerate, isGenerating, canGenerate } = props;
  const title = mode === "agreement" ? "Complete Contract Information" : "Complete Receipt Information";
  const sections = sectionsForMode(mode);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(sections.map((s) => [s.section, true]))
  );

  const requiredSet = useMemo(() => {
    const entries = MODAL_FIELDS.filter((f) => (f.mode === "both" || f.mode === mode) && (!f.visible || f.visible(values, meta)) && f.required(values, meta)).map((f) => f.key);
    return new Set(entries);
  }, [meta, mode, values]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-lg border border-app surface shadow-xl">
        <div className="border-b border-app px-4 py-3">
          <div className="text-base font-semibold text-app">{title}</div>
          <div className="mt-1 text-xs text-muted">
            Information you fill here will be saved to the deal record so you don&apos;t have to fill it again next time.
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {sections.map(({ section, fields }) => (
            <div key={section} className="rounded-md border border-app bg-white">
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-app"
                onClick={() => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }))}
              >
                {section} {expanded[section] ? "▾" : "▸"}
              </button>
              {expanded[section] ? (
                <div className="border-t border-app p-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fields
                    .filter((f) => !f.visible || f.visible(values, meta))
                    .map((field) => {
                      const required = requiredSet.has(field.key);
                      const err = errors[field.key];
                      return (
                        <label key={field.key} className="space-y-1">
                          <span className="text-xs font-semibold text-app">
                            {field.label} {required ? <span className="text-red-500">*</span> : null}
                          </span>
                          {field.input === "select" ? (
                            <select
                              value={values[field.key]}
                              onChange={(e) => onChange(field.key, e.target.value)}
                              className={`w-full rounded-md border px-2 py-1 text-sm outline-none ${err ? "border-red-500" : "border-app"} bg-white text-app`}
                            >
                              {(field.options || []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={field.input === "number" ? "number" : "text"}
                              value={values[field.key]}
                              onChange={(e) => onChange(field.key, e.target.value)}
                              className={`w-full rounded-md border px-2 py-1 text-sm outline-none ${err ? "border-red-500" : "border-app"} bg-white text-app`}
                            />
                          )}
                          {err ? <div className="text-[11px] text-red-500">{err}</div> : required ? <div className="text-[11px] text-red-500">Required</div> : null}
                        </label>
                      );
                    })}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-app px-4 py-3">
          <Button type="button" variant="outline" size="sm" onPress={onClose} isDisabled={isGenerating}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" onPress={onGenerate} isDisabled={!canGenerate || isGenerating}>
            {isGenerating ? "Generating..." : "Generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
