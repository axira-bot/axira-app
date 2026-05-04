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

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function InquiriesPage() {
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

  useEffect(() => { fetchInquiries(); }, []);

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    await supabase.from("inquiries").update({ status }).eq("id", id);
    setInquiries((prev) => prev.map((i) => i.id === id ? { ...i, status } : i));
    setUpdatingId(null);
  };

  const saveNotes = async (id: string) => {
    const notes = notesEdit[id] ?? "";
    setUpdatingId(id);
    await supabase.from("inquiries").update({ notes }).eq("id", id);
    setInquiries((prev) => prev.map((i) => i.id === id ? { ...i, notes } : i));
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
      setWaError(payload.error || "Failed to assign inquiry.");
      return;
    }
    setInquiries((prev) =>
      prev.map((i) => (i.id === id ? { ...i, assigned_employee_id: employeeId || null } : i))
    );
    setUpdatingId(null);
  };

  const createWhatsAppInquiry = async () => {
    if (!newWa.name.trim() || !newWa.phone.trim()) {
      setWaError("Client name and phone are required.");
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

    const extendedPayload = {
      ...basePayload,
      source_channel: "whatsapp",
      whatsapp_ref: newWa.whatsappRef.trim() || null,
      assigned_employee_id: newWa.assignedEmployeeId || null,
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
      setWaError(payload.error || "Failed to create WhatsApp inquiry.");
      return;
    }

    const row = payload.row as Inquiry | undefined;
    if (!row) {
      setWaError("Failed to create WhatsApp inquiry.");
      return;
    }
    setInquiries((prev) => [row, ...prev]);
    setNewWa({ name: "", phone: "", message: "", carLabel: "", whatsappRef: "", assignedEmployeeId: "" });
  };

  const filtered = filter === "all" ? inquiries : inquiries.filter((i) => i.status === filter);
  const newCount = inquiries.filter((i) => i.status === "new").length;

  return (
    <div className="min-h-full text-foreground" style={{ background: "var(--color-bg)" }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Inquiries</h1>
            <p className="text-sm font-medium text-danger">
              Client requests from the public website
            </p>
          </div>
          {newCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              {newCount} new
            </span>
          )}
        </header>

        <div className="flex flex-wrap gap-2">
          {["all", ...STATUS_OPTIONS].map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={filter === s ? "primary" : "outline"}
              className="capitalize"
              onPress={() => setFilter(s)}
            >
              {s === "all" ? `All (${inquiries.length})` : s}
            </Button>
          ))}
        </div>

        <Card.Root className="border border-default-200 shadow-sm">
          <Card.Content className="space-y-3">
            <Text className="text-xs font-semibold uppercase tracking-wide text-default-500">WhatsApp Intake</Text>
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
                <Label className="text-xs text-default-500">Client name</Label>
                <Input className="text-xs" placeholder="Client name" />
              </TextField>
              <TextField
                name="waPhone"
                value={newWa.phone}
                onChange={(v) => setNewWa((p) => ({ ...p, phone: v }))}
              >
                <Label className="text-xs text-default-500">Phone</Label>
                <Input className="text-xs" placeholder="Phone" />
              </TextField>
              <TextField
                name="waRef"
                value={newWa.whatsappRef}
                onChange={(v) => setNewWa((p) => ({ ...p, whatsappRef: v }))}
              >
                <Label className="text-xs text-default-500">WhatsApp ref</Label>
                <Input className="text-xs" placeholder="Thread id" />
              </TextField>
              <TextField
                name="waCar"
                value={newWa.carLabel}
                onChange={(v) => setNewWa((p) => ({ ...p, carLabel: v }))}
              >
                <Label className="text-xs text-default-500">Car label</Label>
                <Input className="text-xs" placeholder="Car label" />
              </TextField>
              <TextField
                name="waMsg"
                value={newWa.message}
                onChange={(v) => setNewWa((p) => ({ ...p, message: v }))}
                className="sm:col-span-2"
              >
                <Label className="text-xs text-default-500">Message</Label>
                <Input className="text-xs" placeholder="Message" />
              </TextField>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-default-500">Assign</Label>
                <select
                  value={newWa.assignedEmployeeId}
                  onChange={(e) => setNewWa((p) => ({ ...p, assignedEmployeeId: e.target.value }))}
                  className="rounded-lg border border-default-200 bg-content1 px-3 py-2 text-xs outline-none focus:border-danger"
                >
                  <option value="">Assign later</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name || "—"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="button" variant="primary" size="sm" onPress={createWhatsAppInquiry}>
              Create WhatsApp Inquiry
            </Button>
          </Card.Content>
        </Card.Root>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <Card.Root className="border border-default-200 shadow-sm">
              <Card.Content className="flex flex-col items-center justify-center gap-3 py-10">
                <Spinner size="md" color="danger" />
                <span className="text-sm text-default-500">Loading inquiries…</span>
              </Card.Content>
            </Card.Root>
          ) : filtered.length === 0 ? (
            <Card.Root className="border border-default-200 shadow-sm">
              <Card.Content className="p-6 text-sm text-default-500">No inquiries found.</Card.Content>
            </Card.Root>
          ) : (
            filtered.map((inq) => {
              const isExpanded = expandedId === inq.id;
              return (
                <Card.Root key={inq.id} className="border border-default-200 shadow-sm">
                  {/* Main row */}
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
                        <span className="text-xs text-muted">{timeAgo(inq.created_at)}</span>
                      </div>
                      <div className="text-sm text-muted">{inq.phone}{inq.email ? ` · ${inq.email}` : ""}</div>
                      {inq.car_label && (
                        <div className="text-xs font-medium text-[var(--color-accent)]">🚗 {inq.car_label}</div>
                      )}
                      {inq.message && (
                        <div className="text-xs text-muted line-clamp-1">{inq.message}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={inq.assigned_employee_id || ""}
                        onChange={(e) => assignInquiry(inq.id, e.target.value)}
                        disabled={updatingId === inq.id}
                        className="rounded-full border border-app px-2 py-0.5 text-[11px] font-semibold outline-none"
                      >
                        <option value="">Unassigned</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.name || "—"}</option>
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
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-app px-4 pb-4 pt-3 space-y-3">
                      {inq.message && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Message</p>
                          <p className="text-sm text-app bg-gray-50 rounded-md p-3">{inq.message}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-1 text-[11px] text-muted sm:grid-cols-2">
                        <span>Source: {inq.source_channel || "public_website"}</span>
                        <span>WhatsApp Ref: {inq.whatsapp_ref || "—"}</span>
                        <span>Assigned: {employees.find((e) => e.id === inq.assigned_employee_id)?.name || "Unassigned"}</span>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Internal Notes</p>
                        <textarea
                          value={notesEdit[inq.id] ?? inq.notes ?? ""}
                          onChange={(e) => setNotesEdit((prev) => ({ ...prev, [inq.id]: e.target.value }))}
                          placeholder="Add notes about this inquiry..."
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
                          {updatingId === inq.id ? "Saving..." : "Save Notes"}
                        </Button>
                      </div>
                      <div className="flex gap-4 text-xs text-muted">
                        <a href={`tel:${inq.phone}`} className="hover:text-app font-medium">📞 Call</a>
                        {inq.email && <a href={`mailto:${inq.email}`} className="hover:text-app font-medium">✉️ Email</a>}
                        <a href={`https://wa.me/${inq.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="hover:text-app font-medium">💬 WhatsApp</a>
                      </div>
                    </div>
                  )}
                </Card.Root>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
