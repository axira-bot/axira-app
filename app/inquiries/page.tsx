"use client";

import { useEffect, useState } from "react";
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
import { supabase } from "@/lib/supabase";
import { PageContainer } from "@/components/ui/page-container";
import { formatDateForLocale, useI18n } from "@/lib/context/I18nContext";

type Inquiry = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  car_label?: string | null;
  message?: string | null;
  status: string;
  notes?: string | null;
  source_channel?: string | null;
  whatsapp_ref?: string | null;
  assigned_employee_id?: string | null;
  created_at: string;
};

type EmployeeOption = { id: string; name: string | null; role: string | null };

const STATUS_OPTIONS = ["new", "contacted", "done", "cancelled"];

const statusStyle: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 border-blue-200",
  contacted: "bg-yellow-100 text-yellow-700 border-yellow-200",
  done: "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
};

function timeAgo(dateStr: string, locale: "en" | "fr" | "ar", t: ReturnType<typeof useI18n>["t"]): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return t("inquiries.time.justNow");
  if (diff < 3600) return t("inquiries.time.minutesAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("inquiries.time.hoursAgo", { n: Math.floor(diff / 3600) });
  return formatDateForLocale(locale, dateStr);
}

export default function InquiriesPage() {
  const { t, locale } = useI18n();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notesEdit, setNotesEdit] = useState<Record<string, string>>({});
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [newWa, setNewWa] = useState({
    name: "",
    phone: "",
    message: "",
    carLabel: "",
    whatsappRef: "",
    assignedEmployeeId: "",
  });
  const [waError, setWaError] = useState<string | null>(null);

  const fetchInquiries = async () => {
    setIsLoading(true);
    const [{ data }, { data: emps }] = await Promise.all([
      supabase
        .from("inquiries")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("employees").select("id, name, role").eq("status", "active").order("name", { ascending: true }),
    ]);
    setInquiries((data as Inquiry[]) || []);
    setEmployees((emps as EmployeeOption[]) || []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchInquiries();
  }, []);

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    await supabase.from("inquiries").update({ status }).eq("id", id);
    setInquiries((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    setUpdatingId(null);
  };

  const saveNotes = async (id: string) => {
    const notes = notesEdit[id] ?? "";
    setUpdatingId(id);
    await supabase.from("inquiries").update({ notes }).eq("id", id);
    setInquiries((prev) => prev.map((i) => (i.id === id ? { ...i, notes } : i)));
    setUpdatingId(null);
  };

  const assignInquiry = async (id: string, employeeId: string) => {
    setUpdatingId(id);
    const res = await fetch("/api/inquiries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, assigned_employee_id: employeeId || null }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUpdatingId(null);
      setWaError(payload.error || t("inquiries.failedAssign"));
      return;
    }
    setInquiries((prev) =>
      prev.map((i) => (i.id === id ? { ...i, assigned_employee_id: employeeId || null } : i))
    );
    setUpdatingId(null);
  };

  const createWhatsAppInquiry = async () => {
    if (!newWa.name.trim() || !newWa.phone.trim()) {
      setWaError(t("inquiries.namePhoneRequired"));
      return;
    }
    setWaError(null);

    const basePayload = {
      name: newWa.name.trim(),
      phone: newWa.phone.trim(),
      message: newWa.message.trim() || null,
      car_label: newWa.carLabel.trim() || null,
      status: "new",
      source: "whatsapp",
      notes: newWa.whatsappRef.trim() ? `WA_REF:${newWa.whatsappRef.trim()}` : null,
    };

    const res = await fetch("/api/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: basePayload.name,
        phone: basePayload.phone,
        message: basePayload.message,
        car_label: basePayload.car_label,
        whatsapp_ref: newWa.whatsappRef.trim() || null,
        assigned_employee_id: newWa.assignedEmployeeId || null,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setWaError(payload.error || t("inquiries.failedCreate"));
      return;
    }

    const row = payload.row as Inquiry | undefined;
    if (!row) {
      setWaError(t("inquiries.failedCreate"));
      return;
    }
    setInquiries((prev) => [row, ...prev]);
    setNewWa({ name: "", phone: "", message: "", carLabel: "", whatsappRef: "", assignedEmployeeId: "" });
  };

  const filtered = filter === "all" ? inquiries : inquiries.filter((i) => i.status === filter);
  const newCount = inquiries.filter((i) => i.status === "new").length;

  return (
    <div className="min-h-full text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="md">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("inquiries.title")}</h1>
            <p className="text-sm font-medium text-danger">{t("inquiries.subtitle")}</p>
          </div>
          {newCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              {t("inquiries.newBadge", { count: newCount })}
            </span>
          )}
        </header>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={filter === "all" ? "primary" : "outline"}
            className="capitalize"
            onPress={() => setFilter("all")}
          >
            {t("common.allCount", { count: inquiries.length })}
          </Button>
          {STATUS_OPTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={filter === s ? "primary" : "outline"}
              className="capitalize"
              onPress={() => setFilter(s)}
            >
              {t(`inquiries.status.${s}`)}
            </Button>
          ))}
        </div>

        <Card.Root className="border border-default-200 shadow-sm">
          <Card.Content className="space-y-3">
            <Text className="text-xs font-semibold uppercase tracking-wide text-default-500">{t("inquiries.whatsappIntake")}</Text>
            {waError ? (
              <Alert.Root status="danger">
                <Alert.Content>
                  <Alert.Description>{waError}</Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <TextField
                name="waName"
                value={newWa.name}
                onChange={(v) => setNewWa((p) => ({ ...p, name: v }))}
              >
                <Label className="text-xs text-default-500">{t("inquiries.clientName")}</Label>
                <Input className="text-xs" placeholder={t("inquiries.clientName")} />
              </TextField>
              <TextField
                name="waPhone"
                value={newWa.phone}
                onChange={(v) => setNewWa((p) => ({ ...p, phone: v }))}
              >
                <Label className="text-xs text-default-500">{t("inquiries.phone")}</Label>
                <Input className="text-xs" placeholder={t("inquiries.phone")} />
              </TextField>
              <TextField
                name="waRef"
                value={newWa.whatsappRef}
                onChange={(v) => setNewWa((p) => ({ ...p, whatsappRef: v }))}
              >
                <Label className="text-xs text-default-500">{t("inquiries.whatsappRef")}</Label>
                <Input className="text-xs" placeholder={t("inquiries.threadIdPlaceholder")} />
              </TextField>
              <TextField
                name="waCar"
                value={newWa.carLabel}
                onChange={(v) => setNewWa((p) => ({ ...p, carLabel: v }))}
              >
                <Label className="text-xs text-default-500">{t("inquiries.carLabel")}</Label>
                <Input className="text-xs" placeholder={t("inquiries.carLabel")} />
              </TextField>
              <TextField
                name="waMsg"
                value={newWa.message}
                onChange={(v) => setNewWa((p) => ({ ...p, message: v }))}
                className="sm:col-span-2"
              >
                <Label className="text-xs text-default-500">{t("inquiries.message")}</Label>
                <Input className="text-xs" placeholder={t("inquiries.message")} />
              </TextField>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-default-500">{t("inquiries.assign")}</Label>
                <select
                  value={newWa.assignedEmployeeId}
                  onChange={(e) => setNewWa((p) => ({ ...p, assignedEmployeeId: e.target.value }))}
                  className="rounded-lg border border-default-200 bg-content1 px-3 py-2 text-xs outline-none focus:border-danger"
                >
                  <option value="">{t("inquiries.assignLater")}</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name || t("common.emiDash")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="button" variant="primary" size="sm" onPress={createWhatsAppInquiry}>
              {t("inquiries.createWhatsapp")}
            </Button>
          </Card.Content>
        </Card.Root>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <Card.Root className="border border-default-200 shadow-sm">
              <Card.Content className="flex flex-col items-center justify-center gap-3 py-10">
                <Spinner size="md" color="danger" />
                <span className="text-sm text-default-500">{t("inquiries.loading")}</span>
              </Card.Content>
            </Card.Root>
          ) : filtered.length === 0 ? (
            <Card.Root className="border border-default-200 shadow-sm">
              <Card.Content className="p-6 text-sm text-default-500">{t("inquiries.empty")}</Card.Content>
            </Card.Root>
          ) : (
            filtered.map((inq) => {
              const isExpanded = expandedId === inq.id;
              return (
                <Card.Root key={inq.id} className="border border-default-200 shadow-sm">
                  <div
                    className="flex flex-col gap-2 p-4 cursor-pointer sm:flex-row sm:items-start sm:justify-between"
                    onClick={() => {
                      setExpandedId(isExpanded ? null : inq.id);
                      if (!isExpanded && inq.notes !== undefined) {
                        setNotesEdit((prev) => ({ ...prev, [inq.id]: inq.notes ?? "" }));
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-app">{inq.name}</span>
                        {inq.city && <span className="text-xs text-muted">· {inq.city}</span>}
                        <span className="text-xs text-muted">{timeAgo(inq.created_at, locale, t)}</span>
                      </div>
                      <div className="text-sm text-muted">
                        {inq.phone}
                        {inq.email ? ` · ${inq.email}` : ""}
                      </div>
                      {inq.car_label && (
                        <div className="text-xs font-medium text-[var(--color-accent)]">🚗 {inq.car_label}</div>
                      )}
                      {inq.message && <div className="text-xs text-muted line-clamp-1">{inq.message}</div>}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={inq.assigned_employee_id || ""}
                        onChange={(e) => assignInquiry(inq.id, e.target.value)}
                        disabled={updatingId === inq.id}
                        className="rounded-full border border-app px-2 py-0.5 text-[11px] font-semibold outline-none"
                      >
                        <option value="">{t("inquiries.unassigned")}</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name || t("common.emiDash")}
                          </option>
                        ))}
                      </select>
                      <select
                        value={inq.status}
                        onChange={(e) => updateStatus(inq.id, e.target.value)}
                        disabled={updatingId === inq.id}
                        className={[
                          "rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize outline-none",
                          statusStyle[inq.status] || "bg-gray-100 text-gray-600 border-gray-200",
                        ].join(" ")}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {t(`inquiries.status.${s}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-app px-4 pb-4 pt-3 space-y-3">
                      {inq.message && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
                            {t("inquiries.messageSection")}
                          </p>
                          <p className="text-sm text-app bg-gray-50 rounded-md p-3">{inq.message}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-1 text-[11px] text-muted sm:grid-cols-2">
                        <span>{t("inquiries.sourceLine", { source: inq.source_channel || "public_website" })}</span>
                        <span>{t("inquiries.waRefLine", { ref: inq.whatsapp_ref || t("common.emiDash") })}</span>
                        <span>
                          {t("inquiries.assignedLine", {
                            name:
                              employees.find((e) => e.id === inq.assigned_employee_id)?.name ||
                              t("inquiries.unassigned"),
                          })}
                        </span>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
                          {t("inquiries.internalNotes")}
                        </p>
                        <textarea
                          value={notesEdit[inq.id] ?? inq.notes ?? ""}
                          onChange={(e) => setNotesEdit((prev) => ({ ...prev, [inq.id]: e.target.value }))}
                          placeholder={t("inquiries.notesPlaceholder")}
                          rows={2}
                          className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-1.5"
                          isDisabled={updatingId === inq.id}
                          onPress={() => saveNotes(inq.id)}
                        >
                          {updatingId === inq.id ? t("inquiries.savingNotes") : t("inquiries.saveNotes")}
                        </Button>
                      </div>
                      <div className="flex gap-4 text-xs text-muted">
                        <a href={`tel:${inq.phone}`} className="hover:text-app font-medium">
                          📞 {t("inquiries.call")}
                        </a>
                        {inq.email && (
                          <a href={`mailto:${inq.email}`} className="hover:text-app font-medium">
                            ✉️ {t("inquiries.email")}
                          </a>
                        )}
                        <a
                          href={`https://wa.me/${inq.phone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-app font-medium"
                        >
                          💬 {t("inquiries.whatsapp")}
                        </a>
                      </div>
                    </div>
                  )}
                </Card.Root>
              );
            })
          )}
        </div>
      </PageContainer>
    </div>
  );
}
