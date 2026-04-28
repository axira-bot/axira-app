"use client";

import { useEffect, useState } from "react";
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
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Inquiries</h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">
              Client requests from the public website
            </p>
          </div>
          {newCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
              {newCount} new
            </span>
          )}
        </header>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2">
          {["all", ...STATUS_OPTIONS].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold transition capitalize",
                filter === s
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-[#C41230]/70",
              ].join(" ")}
            >
              {s === "all" ? `All (${inquiries.length})` : s}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-app surface p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">WhatsApp Intake</div>
          {waError ? (
            <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
              {waError}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input placeholder="Client name" value={newWa.name} onChange={(e) => setNewWa((p) => ({ ...p, name: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app" />
            <input placeholder="Phone" value={newWa.phone} onChange={(e) => setNewWa((p) => ({ ...p, phone: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app" />
            <input placeholder="WhatsApp ref / thread id" value={newWa.whatsappRef} onChange={(e) => setNewWa((p) => ({ ...p, whatsappRef: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app" />
            <input placeholder="Car label" value={newWa.carLabel} onChange={(e) => setNewWa((p) => ({ ...p, carLabel: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app" />
            <input placeholder="Message" value={newWa.message} onChange={(e) => setNewWa((p) => ({ ...p, message: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2" />
            <select value={newWa.assignedEmployeeId} onChange={(e) => setNewWa((p) => ({ ...p, assignedEmployeeId: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app">
              <option value="">Assign later</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name || "—"}</option>)}
            </select>
          </div>
          <button type="button" onClick={createWhatsAppInquiry} className="mt-2 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white">Create WhatsApp Inquiry</button>
        </div>

        {/* List */}
        <div className="flex flex-col gap-3">
          {isLoading ? (
            <div className="rounded-lg border border-app surface p-6 text-sm text-muted">Loading inquiries...</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-app surface p-6 text-sm text-muted">No inquiries found.</div>
          ) : (
            filtered.map((inq) => {
              const isExpanded = expandedId === inq.id;
              return (
                <div key={inq.id} className="rounded-lg border border-app surface">
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
                        <button
                          type="button"
                          onClick={() => saveNotes(inq.id)}
                          disabled={updatingId === inq.id}
                          className="mt-1.5 rounded-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 px-3 py-1 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-50"
                        >
                          {updatingId === inq.id ? "Saving..." : "Save Notes"}
                        </button>
                      </div>
                      <div className="flex gap-4 text-xs text-muted">
                        <a href={`tel:${inq.phone}`} className="hover:text-app font-medium">📞 Call</a>
                        {inq.email && <a href={`mailto:${inq.email}`} className="hover:text-app font-medium">✉️ Email</a>}
                        <a href={`https://wa.me/${inq.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="hover:text-app font-medium">💬 WhatsApp</a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
