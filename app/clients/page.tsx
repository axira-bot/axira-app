"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

type Client = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  type: "Client" | "Prospect" | string | null;
  looking_for: string | null;
  notes: string | null;
  drive_link: string | null;
  created_at?: string | null;
};

type ClientForm = {
  fullName: string;
  phone: string;
  email: string;
  type: "Client" | "Prospect";
  lookingFor: string;
  notes: string;
  driveLink: string;
};

type Tab = "Clients" | "Prospects";

const emptyForm: ClientForm = {
  fullName: "",
  phone: "",
  email: "",
  type: "Client",
  lookingFor: "",
  notes: "",
  driveLink: "",
};

function DriveLinkIcon({ href }: { href: string }) {
  if (!href?.trim()) return null;
  return (
    <a
      href={href.startsWith("http") ? href : `https://${href}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open Google Drive folder"
      className="inline-flex items-center justify-center rounded border border-[#222222] bg-[#0a0a0a] p-1.5 text-zinc-400 transition hover:border-[#c0392b]/70 hover:text-white"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}

export default function ClientsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("Clients");
  const [search, setSearch] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const fetchClients = async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("clients")
      .select("*")
      .order("name", { ascending: true });

    if (fetchError) {
      setError(
        [
          "Failed to load clients.",
          fetchError.message,
          fetchError.details,
          fetchError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
      setClients([]);
      setIsLoading(false);
      return;
    }

    setClients((data as Client[]) ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase();
    return clients.filter((c) => {
      const type = (c.type || "Client") as "Client" | "Prospect";
      if (activeTab === "Clients" && type !== "Client") return false;
      if (activeTab === "Prospects" && type !== "Prospect") return false;
      if (!term) return true;
      const name = (c.name || "").toLowerCase();
      const phone = (c.phone || "").toLowerCase();
      return name.includes(term) || phone.includes(term);
    });
  }, [clients, activeTab, search]);

  const openAddModal = () => {
    setEditingClientId(null);
    setForm(emptyForm);
    setIsModalOpen(true);
    setError(null);
  };

  const openEditModal = (client: Client) => {
    setEditingClientId(client.id);
    setForm({
      fullName: client.name || "",
      phone: client.phone || "",
      email: client.email || "",
      type: (client.type as "Client" | "Prospect") || "Client",
      lookingFor: client.looking_for || "",
      notes: client.notes || "",
      driveLink: client.drive_link || "",
    });
    setIsModalOpen(true);
    setError(null);
  };

  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
  };

  const updateField = <K extends keyof ClientForm>(
    key: K,
    value: ClientForm[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.fullName.trim()) return "Name is required.";
    if (!form.phone.trim()) return "Phone is required.";
    return null;
  };

  const handleSave = async () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }

    setIsSaving(true);
    setError(null);

    const payload = {
      name: form.fullName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      type: form.type,
      looking_for: form.lookingFor.trim() || null,
      notes: form.notes.trim() || null,
      drive_link: form.driveLink.trim() || null,
    };

    if (editingClientId) {
      const { error: updateError } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", editingClientId);
      if (updateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase update client error:", updateError);
        setError(
          [
            "Failed to update client.",
            updateError.message,
            updateError.details,
            updateError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
        setIsSaving(false);
        return;
      }
      await logActivity({
        action: "updated",
        entity: "client",
        entity_id: editingClientId,
        description: `Client updated – ${payload.name || payload.phone || ""}`.trim(),
      });
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("clients")
        .insert(payload)
        .select("id")
        .single();
      if (insertError) {
        // eslint-disable-next-line no-console
        console.log("Supabase insert client error:", insertError);
        setError(
          [
            "Failed to add client.",
            insertError.message,
            insertError.details,
            insertError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
        setIsSaving(false);
        return;
      }
      const newId = (inserted as { id: string } | null)?.id;
      if (newId) {
        await logActivity({
          action: "created",
          entity: "client",
          entity_id: newId,
          description: `Client added – ${payload.name || payload.phone || ""}`.trim(),
        });
      }
    }

    await fetchClients();
    setIsSaving(false);
    setIsModalOpen(false);
  };

  const handleDelete = async (client: Client) => {
    if (
      !window.confirm(
        `Delete client ${client.name || client.phone || client.id}? This cannot be undone.`
      )
    ) {
      return;
    }

    setError(null);
    const { error: deleteError } = await supabase
      .from("clients")
      .delete()
      .eq("id", client.id);

    if (deleteError) {
      // eslint-disable-next-line no-console
      console.log("Supabase delete client error:", deleteError);
      setError(
        [
          "Failed to delete client.",
          deleteError.message,
          deleteError.details,
          deleteError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
      return;
    }
    await logActivity({
      action: "deleted",
      entity: "client",
      entity_id: client.id,
      description: `Client deleted – ${client.name || client.phone || client.id}`,
    });
    setClients((prev) => prev.filter((c) => c.id !== client.id));
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Clients
            </h1>
            <p className="text-sm font-medium text-[#c0392b]">
              Manage clients and prospects
            </p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center justify-center rounded-md bg-[#c0392b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Add Client
          </button>
        </header>

        {/* Tabs + search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            {(["Clients", "Prospects"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold transition",
                  activeTab === tab
                    ? "border-[#c0392b] bg-[#c0392b]/15 text-white"
                    : "border-[#222222] bg-[#111111] text-zinc-300 hover:border-[#c0392b]/70",
                ].join(" ")}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-64">
            <input
              placeholder="Search by name or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-[#222222] bg-[#111111] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Clients table */}
        <div className="rounded-lg border border-[#222222] bg-[#111111]">
          {isLoading ? (
            <div className="p-4 text-sm text-zinc-400">Loading clients...</div>
          ) : filteredClients.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400">No clients found.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[880px] w-full text-left text-xs">
                <thead className="border-b border-[#222222] text-[11px] uppercase tracking-wide text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Looking For</th>
                    <th className="px-4 py-3 w-10">Drive</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => {
                    const type = (client.type || "Client") as "Client" | "Prospect";
                    const typeClass =
                      type === "Client"
                        ? "border-emerald-500/50 bg-emerald-900/40 text-emerald-200"
                        : "border-sky-500/50 bg-sky-900/40 text-sky-200";
                    return (
                      <tr
                        key={client.id}
                        className="border-b border-[#222222] last:border-b-0"
                      >
                        <td className="px-4 py-3 font-semibold text-white">
                          {client.name || "-"}
                        </td>
                        <td className="px-4 py-3 text-zinc-200">
                          {client.phone || "-"}
                        </td>
                        <td className="px-4 py-3 text-zinc-200">
                          {client.email || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={[
                              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              typeClass,
                            ].join(" ")}
                          >
                            {type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-200">
                          {client.looking_for || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <DriveLinkIcon href={client.drive_link ?? ""} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(client)}
                              className="rounded-md border border-[#222222] bg-black px-3 py-1 text-[11px] font-semibold text-zinc-200 hover:border-[#c0392b]/70"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(client)}
                              className="rounded-md border border-[#222222] bg-black px-3 py-1 text-[11px] font-semibold text-zinc-200 hover:border-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Client Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSaving && setIsModalOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-[#222222] bg-[#111111] p-4 text-xs text-zinc-300 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#222222] pb-3">
              <div>
                <div className="text-sm font-semibold text-white">
                  {editingClientId ? "Edit Client" : "Add Client"}
                </div>
                <div className="text-[11px] text-zinc-400">
                  Name and phone are required.
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-[#222222] px-3 py-1 text-[11px] font-semibold text-zinc-200 disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="font-semibold text-zinc-200">
                  Name <span className="text-[#c0392b]">*</span>
                </span>
                <input
                  value={form.fullName}
                  onChange={(e) => updateField("fullName", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-zinc-200">
                  Phone <span className="text-[#c0392b]">*</span>
                </span>
                <input
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-zinc-200">Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-zinc-200">Type</span>
                <select
                  value={form.type}
                  onChange={(e) =>
                    updateField("type", e.target.value as "Client" | "Prospect")
                  }
                  className="w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
                >
                  <option value="Client">Client</option>
                  <option value="Prospect">Prospect</option>
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-zinc-200">
                  Looking for (optional)
                </span>
                <input
                  value={form.lookingFor}
                  onChange={(e) => updateField("lookingFor", e.target.value)}
                  placeholder="e.g. 2023 Prado VX, white, <80k km"
                  className="w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-zinc-200">Google Drive Folder Link</span>
                <input
                  type="text"
                  value={form.driveLink}
                  onChange={(e) => updateField("driveLink", e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-zinc-200">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-xs text-white outline-none focus:border-[#c0392b]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-[#222222] bg-black px-4 py-2 text-xs font-semibold text-zinc-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-md bg-[#c0392b] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
