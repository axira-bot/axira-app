"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Input,
  Label,
  Spinner,
  TextField,
} from "@heroui/react";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/context/AuthContext";
import { PaginatedTable } from "@/components/ui/paginated-table";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { PageContainer } from "@/components/ui/page-container";
import { useI18n } from "@/lib/context/I18nContext";

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

function DriveLinkIcon({ href, title }: { href: string; title: string }) {
  if (!href?.trim()) return null;
  return (
    <a
      href={href.startsWith("http") ? href : `https://${href}`}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="inline-flex items-center justify-center rounded border border-app bg-white p-1.5 text-muted transition hover:border-[var(--color-accent)]/70 hover:text-app"
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
  const { t } = useI18n();
  const { canDelete } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [clientDealCounts, setClientDealCounts] = useState<Record<string, number>>({});
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
        [t("clients.loadFailed"), fetchError.message, fetchError.details, fetchError.hint]
          .filter(Boolean)
          .join(" ")
      );
      setClients([]);
      setIsLoading(false);
      return;
    }

    setClients((data as Client[]) ?? []);
    const { data: dealsData } = await supabase
      .from("deals")
      .select("client_id, client_name");
    const counts: Record<string, number> = {};
    ((dealsData as { client_id?: string | null; client_name?: string | null }[] | null) ?? []).forEach((d) => {
      const key = (d.client_id || d.client_name || "").trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    setClientDealCounts(counts);
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
    if (!form.fullName.trim()) return t("clients.nameRequired");
    if (!form.phone.trim()) return t("clients.phoneRequired");
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
          [t("clients.updateFailed"), updateError.message, updateError.details, updateError.hint]
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
          [t("clients.addFailed"), insertError.message, insertError.details, insertError.hint]
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
    if (!canDelete) return;
    if (
      !window.confirm(
        t("clients.deleteConfirm", {
          name: String(client.name || client.phone || client.id),
        })
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
        [t("clients.deleteFailed"), deleteError.message, deleteError.details, deleteError.hint]
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
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="xl">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {t("clients.title")}
            </h1>
            <p className="text-sm font-medium text-danger">
              {t("clients.subtitle")}
            </p>
          </div>
          <Button type="button" variant="primary" size="sm" onPress={openAddModal}>
            {t("clients.addClient")}
          </Button>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(["Clients", "Prospects"] as Tab[]).map((tab) => (
              <Button
                key={tab}
                type="button"
                size="sm"
                variant={activeTab === tab ? "primary" : "outline"}
                onPress={() => setActiveTab(tab)}
              >
                {tab === "Clients" ? t("clients.tabClients") : t("clients.tabProspects")}
              </Button>
            ))}
          </div>
          <TextField
            name="clientSearch"
            value={search}
            onChange={setSearch}
            className="w-full sm:w-64"
          >
            <Label className="text-xs text-default-500">{t("clients.search")}</Label>
            <Input className="text-xs" placeholder={t("clients.searchPlaceholder")} />
          </TextField>
        </div>

        {error ? (
          <Alert.Root status="danger">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <Card.Root className="overflow-hidden border border-default-200 shadow-sm">
          <Card.Content className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Spinner size="md" color="danger" />
              <span className="text-sm text-default-500">{t("clients.loading")}</span>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="p-4 text-sm text-default-500">{t("clients.empty")}</div>
          ) : (
            <div className="responsive-table-wrap">
              <PaginatedTable
                rows={filteredClients}
                rowKey={(row) => row.id}
                pageSize={10}
                emptyContent={t("clients.empty")}
                columns={[
                  {
                    key: "name",
                    label: t("clients.nameCol"),
                    render: (row) => <span className="font-semibold text-app">{row.name || "-"}</span>,
                  },
                  { key: "phone", label: t("clients.phoneCol"), render: (row) => row.phone || "-" },
                  { key: "email", label: t("clients.emailCol"), render: (row) => row.email || "-" },
                  {
                    key: "type",
                    label: t("clients.typeCol"),
                    render: (row) => (
                      <span className="text-xs font-semibold">
                        {t(`clients.types.${(row.type || "Client") as "Client" | "Prospect"}`)}
                      </span>
                    ),
                  },
                  {
                    key: "lookingFor",
                    label: t("clients.lookingForCol"),
                    render: (row) => row.looking_for || "-",
                  },
                  {
                    key: "drive",
                    label: t("clients.driveCol"),
                    render: (row) => <DriveLinkIcon href={row.drive_link ?? ""} title={t("common.openDriveFolder")} />,
                  },
                  {
                    key: "actions",
                    label: t("clients.actionsCol"),
                    render: (row) => (
                      <RowActionsMenu label={t("clients.clientActions")}>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/deals?clientId=${encodeURIComponent(row.id)}&clientName=${encodeURIComponent(row.name || "")}`
                            )
                          }
                          disabled={!clientDealCounts[row.id] && !clientDealCounts[(row.name || "").trim()]}
                          className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100 disabled:opacity-40"
                        >
                          {t("clients.viewDeals")}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100"
                        >
                          {t("common.edit")}
                        </button>
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/10"
                          >
                            {t("common.delete")}
                          </button>
                        ) : null}
                      </RowActionsMenu>
                    ),
                  },
                ]}
              />
            </div>
          )}
          </Card.Content>
        </Card.Root>
      </PageContainer>

      {/* Add/Edit Client Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSaving && setIsModalOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-app surface p-4 text-xs text-app shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-sm font-semibold text-app">
                  {editingClientId ? t("clients.editClient") : t("clients.addClientModal")}
                </div>
                <div className="text-[11px] text-muted">
                  {t("clients.namePhoneRequiredHint")}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                isDisabled={isSaving}
                onPress={closeModal}
              >
                {t("common.close")}
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="font-semibold text-app">
                  {t("clients.nameLabel")} <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input
                  value={form.fullName}
                  onChange={(e) => updateField("fullName", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-app">
                  {t("clients.phoneLabel")} <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-app">{t("clients.emailLabel")}</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-app">{t("clients.typeLabel")}</span>
                <select
                  value={form.type}
                  onChange={(e) =>
                    updateField("type", e.target.value as "Client" | "Prospect")
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="Client">{t("clients.types.Client")}</option>
                  <option value="Prospect">{t("clients.types.Prospect")}</option>
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-app">
                  {t("clients.lookingForOptional")}
                </span>
                <input
                  value={form.lookingFor}
                  onChange={(e) => updateField("lookingFor", e.target.value)}
                  placeholder={t("clients.lookingForPlaceholder")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-app">{t("clients.driveLinkLabel")}</span>
                <input
                  type="text"
                  value={form.driveLink}
                  onChange={(e) => updateField("driveLink", e.target.value)}
                  placeholder={t("clients.driveLinkPlaceholder")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-app">{t("clients.notesLabel")}</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" size="sm" isDisabled={isSaving} onPress={closeModal}>
                {t("common.cancel")}
              </Button>
              <Button type="button" variant="primary" size="sm" isDisabled={isSaving} onPress={handleSave}>
                {isSaving ? t("clients.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
