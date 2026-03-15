"use client";

import { useEffect, useMemo, useState } from "react";
import type { Car, Deal } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import dynamic from "next/dynamic";

const InvoiceDownloadButton = dynamic(
  () => import("@/components/PDFButtons").then((m) => m.InvoiceDownloadButton),
  { ssr: false }
);
const AgreementDownloadButton = dynamic(
  () => import("@/components/PDFButtons").then((m) => m.AgreementDownloadButton),
  { ssr: false }
);

type DealPayment = {
  id: string;
  deal_id: string;
  dzd: number | null;
  date: string | null;
  type: string | null;
  rate: number | null;
  notes: string | null;
  created_at?: string | null;
};

type ClientDeal = {
  id: string;
  name: string | null;
  phone: string | null;
};

type EmployeeOption = {
  id: string;
  name: string | null;
  role: string | null;
  commission_per_deal: number | null;
  commission_per_managed_deal: number | null;
};

type DealFormState = {
  clientId: string;
  date: string; // YYYY-MM-DD
  carId: string;
  employeeId: string;
  isManagedDeal: boolean;
  saleDzd: string;
  amountReceivedDzd: string;
  rate: string;
  shippingAed: string;
  inspectionAed: string;
  recoveryAed: string;
  maintenanceAed: string;
  otherAed: string;
  shippingPaid: boolean;
  notes: string;
  driveLink: string;
  status: "pending" | "closed";
  saleUsd: string;
};

const emptyForm = (): DealFormState => ({
  clientId: "",
  date: new Date().toISOString().slice(0, 10),
  carId: "",
  employeeId: "",
  isManagedDeal: false,
  saleDzd: "",
  amountReceivedDzd: "0",
  rate: "",
  shippingAed: "",
  inspectionAed: "",
  recoveryAed: "",
  maintenanceAed: "",
  otherAed: "",
  shippingPaid: false,
  notes: "",
  driveLink: "",
  status: "pending",
  saleUsd: "",
});

function DriveLinkIcon({ href }: { href: string }) {
  if (!href?.trim()) return null;
  return (
    <a
      href={href.startsWith("http") ? href : `https://${href}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open Google Drive folder"
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

type FilterTab = "All" | "Pending" | "Closed";

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined, currency: string) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  return `${formatNumber(v)} ${currency}`;
}

function parseNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function carLabel(c: Car) {
  const parts = [c.brand, c.model, c.year ? String(c.year) : null].filter(Boolean);
  return parts.join(" ");
}

export default function DealsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cars, setCars] = useState<Car[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clients, setClients] = useState<ClientDeal[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [quickAddClientOpen, setQuickAddClientOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddPhone, setQuickAddPhone] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<FilterTab>("All");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [form, setForm] = useState<DealFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const [viewDeal, setViewDeal] = useState<Deal | null>(null);
  const [payments, setPayments] = useState<DealPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [newPaymentAmount, setNewPaymentAmount] = useState<string>("");
  const [newPaymentDate, setNewPaymentDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [newPaymentNote, setNewPaymentNote] = useState<string>("");
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);

    const [
      { data: carsData, error: carsError },
      { data: dealsData, error: dealsError },
      { data: clientsData, error: clientsError },
      { data: employeesData, error: employeesError },
    ] = await Promise.all([
      supabase
        .from("cars")
        .select("id, brand, model, year, purchase_price, status, client_name, color, vin, country_of_origin")
        .order("created_at", { ascending: false }),
      supabase.from("deals").select("*").order("date", { ascending: false }),
      supabase.from("clients").select("id, name, phone").order("name", { ascending: true }),
      supabase
        .from("employees")
        .select("id, name, role, commission_per_deal, commission_per_managed_deal")
        .eq("status", "active")
        .order("name", { ascending: true }),
    ]);

    if (carsError || dealsError || clientsError || employeesError) {
      setError(
        [
          "Failed to load deals data.",
          carsError?.message,
          dealsError?.message,
          clientsError?.message,
          employeesError?.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    setCars((carsData as Car[]) ?? []);
    setDeals((dealsData as Deal[]) ?? []);
    setClients((clientsData as ClientDeal[]) ?? []);
    setEmployees((employeesData as EmployeeOption[]) ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredDeals = useMemo(() => {
    if (activeTab === "All") return deals;
    if (activeTab === "Pending")
      return deals.filter((d) => (d.status || "pending").toLowerCase() === "pending");
    return deals.filter((d) => (d.status || "").toLowerCase() === "closed");
  }, [activeTab, deals]);

  const usedCarIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of deals) {
      if (d.car_id) ids.add(d.car_id);
    }
    return ids;
  }, [deals]);

  const availableCars = useMemo(() => {
    return cars.filter((c) => {
      if (!c.id) return false;
      if (editingDealId) {
        const editingDeal = deals.find((d) => d.id === editingDealId);
        if (editingDeal && editingDeal.car_id === c.id) {
          return true;
        }
      }
      return !usedCarIds.has(c.id);
    });
  }, [cars, deals, usedCarIds, editingDealId]);

  const selectedCar = useMemo(() => {
    if (!form.carId) return null;
    return cars.find((c) => c.id === form.carId) || null;
  }, [cars, form.carId]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === form.clientId) ?? null,
    [clients, form.clientId]
  );

  const filteredClientsForDropdown = useMemo(() => {
    const q = clientSearchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q)
    );
  }, [clients, clientSearchQuery]);

  const saleDzd = parseNum(form.saleDzd);
  const amountReceivedDzd = parseNum(form.amountReceivedDzd);
  const rate = parseNum(form.rate);
  const saleAed = rate > 0 ? saleDzd / rate : 0;

  const carCostAed = selectedCar?.purchase_price ?? 0;
  const shippingAed = parseNum(form.shippingAed);
  const inspectionAed = parseNum(form.inspectionAed);
  const recoveryAed = parseNum(form.recoveryAed);
  const maintenanceAed = parseNum(form.maintenanceAed);
  const otherAed = parseNum(form.otherAed);

  const totalExpenses =
    carCostAed +
    shippingAed +
    inspectionAed +
    recoveryAed +
    maintenanceAed +
    otherAed;

  const profitPreview = saleAed - totalExpenses;
  const pendingDzd = Math.max(saleDzd - amountReceivedDzd, 0);

  const openAddModal = () => {
    setEditingDealId(null);
    setForm(emptyForm());
    setIsModalOpen(true);
    setError(null);
  };

  const openEditModal = (deal: Deal) => {
    setEditingDealId(deal.id);
    const dealExt = deal as Deal & { client_id?: string | null; handled_by?: string | null; handled_by_name?: string | null };
    setForm({
      clientId: dealExt.client_id ?? "",
      date: (deal.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      carId: deal.car_id || "",
      employeeId: dealExt.handled_by ?? "",
      isManagedDeal: false,
      saleDzd: deal.sale_dzd != null ? String(deal.sale_dzd) : "",
      amountReceivedDzd:
        deal.collected_dzd != null ? String(deal.collected_dzd) : "0",
      rate: deal.rate != null ? String(deal.rate) : "",
      shippingAed: deal.cost_shipping != null ? String(deal.cost_shipping) : "",
      inspectionAed: deal.cost_inspection != null ? String(deal.cost_inspection) : "",
      recoveryAed: deal.cost_recovery != null ? String(deal.cost_recovery) : "",
      maintenanceAed: deal.cost_maintenance != null ? String(deal.cost_maintenance) : "",
      otherAed: deal.cost_other != null ? String(deal.cost_other) : "",
      shippingPaid: Boolean(deal.shipping_paid),
      notes: deal.notes || "",
      driveLink: (deal as Deal & { drive_link?: string | null }).drive_link ?? "",
      status: ((deal.status || "pending").toLowerCase() === "closed" ? "closed" : "pending"),
      saleUsd: deal.sale_usd != null ? String(deal.sale_usd) : "",
    });
    setIsModalOpen(true);
    setError(null);
  };

  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
  };

  const handleQuickAddClient = async () => {
    const name = quickAddName.trim();
    const phone = quickAddPhone.trim();
    if (!name || !phone) {
      setError("Name and phone are required for new client.");
      return;
    }
    setQuickAddSaving(true);
    setError(null);
    const { data: inserted, error: insertErr } = await supabase
      .from("clients")
      .insert({ name, phone, type: "Client", email: null, looking_for: null, notes: null, drive_link: null })
      .select("id, name, phone")
      .single();
    setQuickAddSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    const newClient = inserted as ClientDeal;
    setClients((prev) => [...prev, newClient].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    updateField("clientId", newClient.id);
    setQuickAddClientOpen(false);
    setQuickAddName("");
    setQuickAddPhone("");
  };

  const updateField = <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.clientId.trim()) return "Client is required.";
    if (!form.date) return "Date is required.";
    if (!form.carId) return "Car is required.";
    if (!form.saleDzd.trim()) return "Sale Price DZD is required.";
    if (!form.rate.trim()) return "Rate at Deal is required.";
    if (rate <= 0) return "Rate at Deal must be > 0.";
    return null;
  };

  const handleSave = async () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    if (amountReceivedDzd > saleDzd) {
      setError(
        `Collected amount cannot exceed sale price of ${formatNumber(saleDzd)} DZD`
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    const car = selectedCar;
    const payload = {
      client_id: form.clientId || null,
      client_name: selectedClient?.name ?? "",
      car_id: form.carId,
      car_label: car ? carLabel(car) : null,
      date: form.date,
      handled_by: form.employeeId || null,
      handled_by_name: form.employeeId ? (employees.find((e) => e.id === form.employeeId)?.name ?? "") : null,
      sale_dzd: saleDzd,
      rate,
      sale_aed: saleAed,
      cost_car: carCostAed,
      cost_shipping: shippingAed,
      cost_inspection: inspectionAed,
      cost_recovery: recoveryAed,
      cost_maintenance: maintenanceAed,
      cost_other: otherAed,
      total_expenses: totalExpenses,
      profit: profitPreview,
      shipping_paid: form.shippingPaid,
      collected_dzd: amountReceivedDzd,
      pending_dzd: pendingDzd,
      status: form.status,
      notes: form.notes || null,
      drive_link: form.driveLink.trim() || null,
      sale_usd: parseNum(form.saleUsd) || null,
    };

    if (editingDealId) {
      const existingDeal = deals.find((d) => d.id === editingDealId);
      const existingExt = existingDeal as (Deal & { handled_by?: string | null }) | undefined;
      const previousEmployeeId = existingExt?.handled_by ?? null;
      const newEmployeeId = form.employeeId || null;

      const { error: updateError } = await supabase.from("deals").update(payload).eq("id", editingDealId);
      if (updateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase deal update error:", updateError);
        setError(
          [
            "Failed to update deal.",
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
        entity: "deal",
        entity_id: editingDealId,
        description: `Deal updated – ${existingDeal?.client_name ?? ""} – ${existingDeal?.car_label ?? ""}`.trim(),
        amount: existingDeal?.sale_aed ?? undefined,
        currency: "AED",
      });

      // Telegram notification — deal closed
      if (payload.status === "closed" && existingDeal?.status !== "closed") {
        fetch("/api/telegram/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "deal_closed",
            data: {
              clientName: existingDeal?.client_name ?? "Unknown",
              carLabel: existingDeal?.car_label ?? "Unknown",
              profit: payload.profit ?? existingDeal?.profit,
            },
          }),
        }).catch(() => {});
      }

      // Handle commission update when handled_by changes or is set
      if (previousEmployeeId !== newEmployeeId) {
        if (previousEmployeeId) {
          await supabase
            .from("commissions")
            .delete()
            .eq("deal_id", editingDealId)
            .eq("employee_id", previousEmployeeId);
        }
        if (newEmployeeId) {
          const emp = employees.find((e) => e.id === newEmployeeId);
          const amount = emp?.commission_per_deal ?? 0;
          const monthSource = form.date || existingDeal?.date || new Date().toISOString();
          const month = monthSource.slice(0, 7);
          if (amount > 0 && month) {
            const { data: existingCommission } = await supabase
              .from("commissions")
              .select("id")
              .eq("deal_id", editingDealId)
              .eq("employee_id", newEmployeeId)
              .limit(1)
              .maybeSingle();

            if (!existingCommission) {
              const { data: insertedCommission, error: commissionError } = await supabase
                .from("commissions")
                .insert({
                  employee_id: newEmployeeId,
                  deal_id: editingDealId,
                  amount,
                  type: "per_deal",
                  status: "pending",
                  month,
                })
                .select("id")
                .single();

              if (!commissionError) {
                // eslint-disable-next-line no-console
                console.log("Commission inserted on deal update", {
                  dealId: editingDealId,
                  employeeId: newEmployeeId,
                  commissionId: (insertedCommission as { id: string } | null)?.id,
                });
              }
            }
          }
        }
      } else if (newEmployeeId) {
        // Same employee; ensure a commission exists
        const { data: existingCommission } = await supabase
          .from("commissions")
          .select("id")
          .eq("deal_id", editingDealId)
          .eq("employee_id", newEmployeeId)
          .limit(1)
          .maybeSingle();

        if (!existingCommission) {
          const emp = employees.find((e) => e.id === newEmployeeId);
          const amount = emp?.commission_per_deal ?? 0;
          const monthSource = form.date || existingDeal?.date || new Date().toISOString();
          const month = monthSource.slice(0, 7);
          if (amount > 0 && month) {
            const { data: insertedCommission, error: commissionError } = await supabase
              .from("commissions")
              .insert({
                employee_id: newEmployeeId,
                deal_id: editingDealId,
                amount,
                type: "per_deal",
                status: "pending",
                month,
              })
              .select("id")
              .single();

            if (!commissionError) {
              // eslint-disable-next-line no-console
              console.log("Commission inserted on deal update (ensure)", {
                dealId: editingDealId,
                employeeId: newEmployeeId,
                commissionId: (insertedCommission as { id: string } | null)?.id,
              });
            }
          }
        }
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("deals")
        .insert(payload)
        .select("*")
        .single();
      if (insertError) {
        // eslint-disable-next-line no-console
        console.log("Supabase deal insert error:", insertError);
        setError(
          [
            "Failed to add deal.",
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

      const dealId = (inserted as Deal).id;
      const newDeal = inserted as Deal;
      await logActivity({
        action: "created",
        entity: "deal",
        entity_id: dealId,
        description: `Deal created – ${newDeal.client_name ?? ""} – ${newDeal.car_label ?? ""}`.trim(),
        amount: newDeal.sale_aed ?? undefined,
        currency: "AED",
      });

      // Telegram notification — new deal
      fetch("/api/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "new_deal",
          data: {
            clientName: newDeal.client_name ?? "Unknown",
            carLabel: newDeal.car_label ?? "Unknown",
            saleDzd: newDeal.sale_dzd,
            saleAed: newDeal.sale_aed,
            saleUsd: newDeal.sale_usd,
            date: newDeal.date ?? new Date().toISOString().slice(0, 10),
          },
        }),
      }).catch(() => {});

      const { error: carUpdateError } = await supabase
        .from("cars")
        .update({ status: "sold" })
        .eq("id", form.carId);
      if (carUpdateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase car status update error:", carUpdateError);
        setError(
          [
            "Deal saved, but failed to mark car as sold.",
            carUpdateError.message,
            carUpdateError.details,
            carUpdateError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
        setDeals((prev) => [inserted as Deal, ...prev]);
        setIsSaving(false);
        setIsModalOpen(false);
        await fetchAll();
        return;
      }

      if (form.employeeId) {
        const employeeId = form.employeeId;
        const emp = employees.find((e) => e.id === employeeId);
        const amount = emp?.commission_per_deal ?? 0;
        const monthSource = form.date || new Date().toISOString();
        const month = monthSource.slice(0, 7);
        if (amount > 0 && month) {
          const { data: existingCommission } = await supabase
            .from("commissions")
            .select("id")
            .eq("deal_id", dealId)
            .eq("employee_id", employeeId)
            .limit(1)
            .maybeSingle();

          if (!existingCommission) {
            const { data: insertedCommission, error: commissionError } = await supabase
              .from("commissions")
              .insert({
                employee_id: employeeId,
                deal_id: dealId,
                amount,
                type: "per_deal",
                status: "pending",
                month,
              })
              .select("id")
              .single();

            if (!commissionError) {
              // eslint-disable-next-line no-console
              console.log("Commission inserted on deal create", {
                dealId,
                employeeId,
                commissionId: (insertedCommission as { id: string } | null)?.id,
              });
            }
          }
        }
      }

      // If some DZD already collected at deal creation, create payment + movement and update Algeria Cash
      if (amountReceivedDzd > 0) {
        const paymentInsert = await supabase
          .from("payments")
          .insert({
            deal_id: dealId,
            dzd: amountReceivedDzd,
            date: form.date,
            type: "deal_init",
            rate,
            notes: form.notes || null,
          })
          .select("*")
          .single();

        if (paymentInsert.error) {
          // eslint-disable-next-line no-console
          console.log("Supabase initial payment insert error:", paymentInsert.error);
        } else {
          const paymentId = (paymentInsert.data as DealPayment).id;

          const aedEquivalent = rate > 0 ? amountReceivedDzd / rate : null;

          const movementInsert = await supabase.from("movements").insert({
            date: form.date,
            type: "In",
            category: "Client Payment",
            description: form.notes || "Initial payment on deal creation",
            amount: amountReceivedDzd,
            currency: "DZD",
            rate: rate || null,
            aed_equivalent: aedEquivalent,
            pocket: "Algeria Cash",
            deal_id: dealId,
            payment_id: paymentId,
            reference: null,
          });

          if (movementInsert.error) {
            // eslint-disable-next-line no-console
            console.log("Supabase initial movement insert error:", movementInsert.error);
          }

          // Update Algeria Cash pocket balance
          const { data: pockets, error: pocketsError } = await supabase
            .from("cash_positions")
            .select("id, pocket, amount, currency")
            .eq("pocket", "Algeria Cash")
            .eq("currency", "DZD")
            .limit(1)
            .maybeSingle();

          if (!pocketsError && pockets) {
            const currentAmount = pockets.amount || 0;
            await supabase
              .from("cash_positions")
              .update({
                amount: currentAmount + amountReceivedDzd,
              })
              .eq("id", pockets.id);
          }
        }
      }
    }

    setIsSaving(false);
    setIsModalOpen(false);
    await fetchAll();
  };

  const handleDelete = async (deal: Deal) => {
    if (!window.confirm("Delete this deal? This cannot be undone.")) return;
    setIsDeletingId(deal.id);
    setError(null);

    // Step 1: Fetch all movements linked to this deal
    const { data: linkedMovements, error: movementsErr } = await supabase
      .from("movements")
      .select("id, type, amount, currency, pocket")
      .eq("deal_id", deal.id);
    if (movementsErr) {
      setError(["Failed to fetch deal movements.", movementsErr.message].filter(Boolean).join(" "));
      setIsDeletingId(null);
      return;
    }
    const movementsToReverse = linkedMovements ?? [];

    // Step 2: For each movement, reverse on cash_positions (must all complete before step 3)
    for (const m of movementsToReverse) {
      const pocket = (m as { pocket?: string }).pocket ?? "";
      const currency = ((m as { currency?: string }).currency || "AED").trim() || "AED";
      const amount = (m as { amount?: number }).amount ?? 0;
      if (!pocket || amount <= 0) continue;

      const { data: pos, error: posErr } = await supabase
        .from("cash_positions")
        .select("id, amount")
        .eq("pocket", pocket)
        .eq("currency", currency)
        .maybeSingle();
      if (posErr) {
        setError(["Failed to fetch cash position for reversal.", posErr.message].filter(Boolean).join(" "));
        setIsDeletingId(null);
        return;
      }
      if (!pos || !(pos as { id?: string }).id) continue;

      const current = (pos as { amount?: number }).amount ?? 0;
      const typeStr = ((m as { type?: string }).type || "").toLowerCase();
      const isIn = typeStr === "in";
      const newAmount = isIn ? current - amount : current + amount;

      const { error: updateErr } = await supabase
        .from("cash_positions")
        .update({ amount: newAmount })
        .eq("id", (pos as { id: string }).id);
      if (updateErr) {
        setError(["Failed to reverse movement on cash position.", updateErr.message].filter(Boolean).join(" "));
        setIsDeletingId(null);
        return;
      }
    }

    // Step 3: Only after all reversals succeeded — delete movements, payments, then deal
    const { error: delMovErr } = await supabase.from("movements").delete().eq("deal_id", deal.id);
    if (delMovErr) {
      setError(["Failed to delete deal movements.", delMovErr.message].filter(Boolean).join(" "));
      setIsDeletingId(null);
      return;
    }
    const { error: delPayErr } = await supabase.from("payments").delete().eq("deal_id", deal.id);
    if (delPayErr) {
      setError(["Failed to delete deal payments.", delPayErr.message].filter(Boolean).join(" "));
      setIsDeletingId(null);
      return;
    }

    const { error: deleteError } = await supabase.from("deals").delete().eq("id", deal.id);
    if (deleteError) {
      // eslint-disable-next-line no-console
      console.log("Supabase deal delete error:", deleteError);
      setError(
        ["Failed to delete deal.", deleteError.message, deleteError.details, deleteError.hint]
          .filter(Boolean)
          .join(" ")
      );
      setIsDeletingId(null);
      return;
    }
    await logActivity({
      action: "deleted",
      entity: "deal",
      entity_id: deal.id,
      description: `Deal deleted – ${deal.client_name ?? ""} – ${deal.car_label ?? ""}`.trim(),
      amount: deal.sale_aed ?? undefined,
      currency: "AED",
    });

    setDeals((prev) => prev.filter((d) => d.id !== deal.id));
    if (viewDeal?.id === deal.id) {
      setViewDeal(null);
      setPayments([]);
    }
    setIsDeletingId(null);
  };

  const openView = async (deal: Deal) => {
    setViewDeal(deal);
    setPayments([]);
    setPaymentsError(null);
    setPaymentsLoading(true);
    setNewPaymentAmount("");
    setNewPaymentDate(new Date().toISOString().slice(0, 10));
    setNewPaymentNote("");

    const { data, error: pError } = await supabase
      .from("payments")
      .select("*")
      .eq("deal_id", deal.id)
      .order("date", { ascending: false })
      .limit(25);

    if (pError) {
      setPaymentsError(
        [
          "Could not load payment history (table might not exist yet).",
          pError.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
      setPayments([]);
    } else {
      setPayments((data as DealPayment[]) ?? []);
    }
    setPaymentsLoading(false);
  };

  const closeView = () => {
    setViewDeal(null);
    setPayments([]);
    setPaymentsError(null);
    setNewPaymentAmount("");
    setNewPaymentNote("");
  };

  const handleAddPayment = async () => {
    if (!viewDeal) return;

    const amount = parseNum(newPaymentAmount);
    if (amount <= 0) {
      setPaymentsError("Payment amount must be greater than 0.");
      return;
    }
    const pendingDzd = viewDeal.pending_dzd ?? 0;
    if (amount > pendingDzd) {
      setPaymentsError(
        `Payment exceeds remaining balance. Maximum: ${formatNumber(pendingDzd)} DZD`
      );
      return;
    }

    const date = newPaymentDate || new Date().toISOString().slice(0, 10);

    setIsAddingPayment(true);
    setPaymentsError(null);

    const dealId = viewDeal.id;

    // 1. Insert into payments table
    const {
      data: insertedPayment,
      error: paymentError,
    } = await supabase
      .from("payments")
      .insert({
        deal_id: dealId,
        dzd: amount,
        date,
        type: "client_payment",
        rate: viewDeal.rate || null,
        notes: newPaymentNote || null,
      })
      .select("*")
      .single();

    if (paymentError) {
      // eslint-disable-next-line no-console
      console.log("Supabase add payment error:", paymentError);
      setPaymentsError(
        [
          "Failed to add payment.",
          paymentError.message,
          paymentError.details,
          paymentError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
      setIsAddingPayment(false);
      return;
    }

    // 2. Update collected_dzd and pending_dzd on the deal
    const prevCollected = viewDeal.collected_dzd || 0;
    const prevPending = viewDeal.pending_dzd || 0;
    const collected = prevCollected + amount;
    const pending = Math.max(prevPending - amount, 0);

    const { error: dealUpdateError } = await supabase
      .from("deals")
      .update({
        collected_dzd: collected,
        pending_dzd: pending,
      })
      .eq("id", dealId);

    if (dealUpdateError) {
      // eslint-disable-next-line no-console
      console.log("Supabase update deal collected/pending error:", dealUpdateError);
      setPaymentsError(
        [
          "Payment recorded, but failed to update deal balances.",
          dealUpdateError.message,
          dealUpdateError.details,
          dealUpdateError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    // 3. Insert a movement for this payment
    const { error: movementError } = await supabase.from("movements").insert({
      date,
      type: "In",
      category: "Client Payment",
      description:
        `${viewDeal.client_name || ""} ${viewDeal.car_label || ""}`.trim() ||
        "Client payment",
      amount,
      currency: "DZD",
      rate: viewDeal.rate || null,
      aed_equivalent:
        viewDeal.rate && viewDeal.rate > 0 ? amount / viewDeal.rate : null,
      pocket: "Algeria Cash",
      deal_id: dealId,
      payment_id: (insertedPayment as DealPayment).id,
      reference: null,
    });

    if (movementError) {
      // eslint-disable-next-line no-console
      console.log("Supabase client payment movement insert error:", movementError);
      setPaymentsError(
        [
          "Payment saved, but failed to create client payment movement.",
          movementError.message,
          movementError.details,
          movementError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
    } else {
      await logActivity({
        action: "paid",
        entity: "payment",
        entity_id: (insertedPayment as DealPayment).id,
        description: `Payment added – ${formatNumber(amount)} DZD – ${viewDeal.client_name ?? ""} – ${viewDeal.car_label ?? ""}`.trim(),
        amount,
        currency: "DZD",
      });
    }

    // 4. Update Algeria Cash pocket balance
    const {
      data: algeriaPocket,
      error: pocketFetchError,
    } = await supabase
      .from("cash_positions")
      .select("id, amount, currency, pocket")
      .eq("pocket", "Algeria Cash")
      .eq("currency", "DZD")
      .maybeSingle();

    if (pocketFetchError) {
      // eslint-disable-next-line no-console
      console.log("Supabase fetch Algeria Cash pocket error:", pocketFetchError);
      setPaymentsError(
        [
          "Payment saved, but failed to fetch Algeria Cash pocket.",
          pocketFetchError.message,
          pocketFetchError.details,
          pocketFetchError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
    } else if (algeriaPocket) {
      const currentAmount =
        (algeriaPocket as { amount: number | null }).amount || 0;
      const newAmount = currentAmount + amount;
      const { error: pocketUpdateError } = await supabase
        .from("cash_positions")
        .update({ amount: newAmount })
        .eq("id", (algeriaPocket as { id: string }).id);

      if (pocketUpdateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase update Algeria Cash pocket error:", pocketUpdateError);
        setPaymentsError(
          [
            "Payment saved, but failed to update Algeria Cash balance.",
            pocketUpdateError.message,
            pocketUpdateError.details,
            pocketUpdateError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
      }
    }

    // Update local state so UI reflects latest values
    setPayments((prev) => [insertedPayment as DealPayment, ...prev]);
    setViewDeal((prev) =>
      prev ? { ...prev, collected_dzd: collected, pending_dzd: pending } : prev
    );
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, collected_dzd: collected, pending_dzd: pending } : d
      )
    );

    setNewPaymentAmount("");
    setNewPaymentNote("");
    setIsAddingPayment(false);
    setIsPaymentFormOpen(false);
  };

  const handleDeletePayment = async (payment: DealPayment) => {
    if (!viewDeal) return;
    const amount = payment.dzd ?? 0;
    if (amount <= 0) return;
    if (!window.confirm("Remove this payment? Deal balances will be updated and the payment movement reversed.")) return;
    setDeletingPaymentId(payment.id);
    setPaymentsError(null);

    const { data: movementRows } = await supabase
      .from("movements")
      .select("id")
      .eq("payment_id", payment.id)
      .limit(1);
    const movementId = movementRows?.[0]?.id;

    const {
      data: algeriaPocket,
      error: pocketErr,
    } = await supabase
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", "Algeria Cash")
      .eq("currency", "DZD")
      .maybeSingle();
    if (pocketErr || !algeriaPocket) {
      setPaymentsError("Could not load Algeria Cash position to reverse payment.");
      setDeletingPaymentId(null);
      return;
    }
    const current = (algeriaPocket as { amount?: number }).amount ?? 0;
    const newAmount = current - amount;
    const { error: updatePosErr } = await supabase
      .from("cash_positions")
      .update({ amount: newAmount })
      .eq("id", (algeriaPocket as { id: string }).id);
    if (updatePosErr) {
      setPaymentsError(updatePosErr.message);
      setDeletingPaymentId(null);
      return;
    }

    const prevCollected = viewDeal.collected_dzd ?? 0;
    const prevPending = viewDeal.pending_dzd ?? 0;
    const collected = prevCollected - amount;
    const pending = prevPending + amount;
    const { error: dealUpdateErr } = await supabase
      .from("deals")
      .update({ collected_dzd: collected, pending_dzd: pending })
      .eq("id", viewDeal.id);
    if (dealUpdateErr) {
      setPaymentsError(dealUpdateErr.message);
      setDeletingPaymentId(null);
      return;
    }

    const { error: payDelErr } = await supabase.from("payments").delete().eq("id", payment.id);
    if (payDelErr) {
      setPaymentsError(payDelErr.message);
      setDeletingPaymentId(null);
      return;
    }
    if (movementId) {
      await supabase.from("movements").delete().eq("id", movementId);
    }

    setPayments((prev) => prev.filter((p) => p.id !== payment.id));
    setViewDeal((prev) => (prev ? { ...prev, collected_dzd: collected, pending_dzd: pending } : prev));
    setDeals((prev) =>
      prev.map((d) => (d.id === viewDeal.id ? { ...d, collected_dzd: collected, pending_dzd: pending } : d))
    );
    setDeletingPaymentId(null);
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Deals</h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">Sales & Profit</p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app hover:opacity-90"
          >
            Add Deal
          </button>
        </header>

        <div className="flex flex-wrap gap-2">
          {(["All", "Pending", "Closed"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                activeTab === tab
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-app"
                  : "border-app surface text-app hover:border-[var(--color-accent)]/70",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-app surface">
          {isLoading ? (
            <div className="p-4 text-sm text-muted">Loading deals...</div>
          ) : filteredDeals.length === 0 ? (
            <div className="p-4 text-sm text-muted">No deals found.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[1120px] w-full text-left text-xs">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Car</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Sale DZD</th>
                    <th className="px-4 py-3">Rate</th>
                    <th className="px-4 py-3">Sale AED</th>
                    <th className="px-4 py-3">Total Expenses</th>
                    <th className="px-4 py-3">Profit</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 w-10">Drive</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((d) => {
                    const status = (d.status || "pending").toLowerCase();
                    const total =
                      (d.cost_car || 0) +
                      (d.cost_shipping || 0) +
                      (d.cost_inspection || 0) +
                      (d.cost_recovery || 0) +
                      (d.cost_maintenance || 0) +
                      (d.cost_other || 0);
                    return (
                      <tr key={d.id} className="border-b border-app last:border-b-0">
                        <td className="px-4 py-3 font-semibold text-app">
                          {d.client_name || "-"}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {d.car_label || "-"}
                        </td>
                        <td className="px-4 py-3 text-app">{formatDate(d.date ?? d.created_at)}</td>
                        <td className="px-4 py-3 text-app">{formatMoney(d.sale_dzd, "DZD")}</td>
                        <td className="px-4 py-3 text-app">{d.rate != null ? formatNumber(d.rate) : "-"}</td>
                        <td className="px-4 py-3 text-app">{formatMoney(d.sale_aed, "AED")}</td>
                        <td className="px-4 py-3 text-app">{formatMoney(total, "AED")}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--color-accent)]">{formatMoney(d.profit, "AED")}</td>
                        <td className="px-4 py-3">
                          <span
                            className={[
                              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              status === "closed"
                                ? "border-app bg-black text-app"
                                : "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-app",
                            ].join(" ")}
                          >
                            {status === "closed" ? "closed" : "pending"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <DriveLinkIcon href={(d as Deal & { drive_link?: string | null }).drive_link ?? ""} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(d)}
                              className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)]/70"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(d)}
                              disabled={isDeletingId === d.id}
                              className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-red-700 disabled:opacity-50"
                            >
                              {isDeletingId === d.id ? "Deleting..." : "Delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => openView(d)}
                              className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)]/70"
                            >
                              View
                            </button>
                            {d.sale_usd ? (() => {
                              const dealCar = cars.find((c) => c.id === d.car_id);
                              const dealDate = d.date ? new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "";
                              const invoiceNum = `INV-${d.id.slice(0, 8).toUpperCase()}`;
                              return (
                                <>
                                  <InvoiceDownloadButton
                                    filename={`Invoice-${d.client_name}-${dealDate}.pdf`}
                                    data={{
                                      invoiceNumber: invoiceNum,
                                      date: dealDate,
                                      clientName: d.client_name || "",
                                      carBrand: dealCar?.brand || (d.car_label?.split(" ")[0] ?? ""),
                                      carModel: dealCar?.model || (d.car_label?.split(" ").slice(1, -1).join(" ") ?? ""),
                                      carYear: dealCar?.year ?? null,
                                      carColor: dealCar?.color ?? null,
                                      carVin: dealCar?.vin ?? null,
                                      countryOfOrigin: (dealCar as Car & { country_of_origin?: string | null })?.country_of_origin ?? null,
                                      saleUsd: d.sale_usd ?? 0,
                                      exportTo: "Algeria",
                                    }}
                                  />
                                  <AgreementDownloadButton
                                    filename={`Agreement-${d.client_name}-${dealDate}.pdf`}
                                    data={{
                                      date: dealDate,
                                      clientName: d.client_name || "",
                                      carBrand: dealCar?.brand || (d.car_label?.split(" ")[0] ?? ""),
                                      carModel: dealCar?.model || (d.car_label?.split(" ").slice(1, -1).join(" ") ?? ""),
                                      carYear: dealCar?.year ?? null,
                                      carColor: dealCar?.color ?? null,
                                      carVin: dealCar?.vin ?? null,
                                      countryOfOrigin: (dealCar as Car & { country_of_origin?: string | null })?.country_of_origin ?? null,
                                      totalAmountUsd: d.sale_usd ?? 0,
                                      advanceUsd: d.sale_usd && d.collected_dzd && d.rate ? Math.round(d.collected_dzd / d.rate) : 0,
                                      balanceUsd: d.sale_usd && d.pending_dzd && d.rate ? Math.round(d.pending_dzd / d.rate) : 0,
                                    }}
                                  />
                                </>
                              );
                            })() : null}
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

      {/* Add/Edit Modal */}
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative flex w-full max-w-3xl max-h-screen flex-col overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  {editingDealId ? "Edit Deal" : "Add Deal"}
                </div>
                <div className="text-xs text-muted">
                  Sale AED and Profit update automatically as you type.
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Date</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Client</span>
                <div className="relative">
                  <input
                    type="text"
                    value={clientDropdownOpen ? clientSearchQuery : (selectedClient?.name ?? "")}
                    onChange={(e) => {
                      setClientSearchQuery(e.target.value);
                      setClientDropdownOpen(true);
                    }}
                    onFocus={() => setClientDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setClientDropdownOpen(false), 200)}
                    placeholder="Search or select client..."
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                  {clientDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-app surface py-1 shadow-lg">
                      {filteredClientsForDropdown.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">No clients match</div>
                      ) : (
                        filteredClientsForDropdown.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              updateField("clientId", c.id);
                              setClientSearchQuery("");
                              setClientDropdownOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-app hover:bg-[#222222]"
                          >
                            <span>{c.name || "—"}</span>
                            {c.phone ? <span className="text-gray-400 text-xs">{c.phone}</span> : null}
                          </button>
                        ))
                      )}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setClientDropdownOpen(false);
                          setQuickAddName(clientSearchQuery.trim() || "");
                          setQuickAddPhone("");
                          setQuickAddClientOpen(true);
                        }}
                        className="flex w-full items-center gap-2 border-t border-app px-3 py-2 text-left text-sm text-[var(--color-accent)] hover:bg-[#222222]"
                      >
                        + Add new client
                      </button>
                    </div>
                  )}
                </div>
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Car</span>
                <select
                  value={form.carId}
                  onChange={(e) => updateField("carId", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">Select a car (available)</option>
                  {availableCars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {carLabel(c)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Handled by</span>
                <select
                  value={form.employeeId}
                  onChange={(e) => updateField("employeeId", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">No employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name ?? "—"} ({e.role ?? "—"})
                    </option>
                  ))}
                </select>
                {form.employeeId && employees.find((e) => e.id === form.employeeId)?.role === "Manager" && (
                  <label className="mt-2 flex items-center gap-2 text-muted">
                    <input
                      type="checkbox"
                      checked={form.isManagedDeal}
                      onChange={(e) => updateField("isManagedDeal", e.target.checked)}
                      className="rounded border-app bg-white text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    />
                    <span>Fully managed (use manager commission rate)</span>
                  </label>
                )}
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Sale Price DZD</span>
                <input
                  type="number"
                  value={form.saleDzd}
                  onChange={(e) => updateField("saleDzd", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Amount Received DZD</span>
                <input
                  type="number"
                  value={form.amountReceivedDzd}
                  onChange={(e) => updateField("amountReceivedDzd", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <div className="rounded-md border border-app bg-black px-3 py-2 text-xs text-app">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-app">Pending DZD</span>
                  <span className="text-app">{formatMoney(pendingDzd, "DZD")}</span>
                </div>
              </div>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Rate at Deal (DZD/AED)</span>
                <input
                  type="number"
                  value={form.rate}
                  onChange={(e) => updateField("rate", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <div className="rounded-md border border-app bg-black px-3 py-2 text-xs text-app sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-app">Sale AED</span>
                  <span className="text-app">{formatMoney(saleAed, "AED")}</span>
                </div>
              </div>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Sale Price USD <span className="text-[10px] font-normal text-zinc-400">(for invoice &amp; agreement)</span></span>
                <input
                  type="number"
                  value={form.saleUsd}
                  onChange={(e) => updateField("saleUsd", e.target.value)}
                  placeholder="e.g. 6450"
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <div className="sm:col-span-2">
                <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  Expenses (AED)
                </div>
              </div>

              <div className="rounded-md border border-app bg-black px-3 py-2 text-xs text-app sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-app">Car Cost AED</span>
                  <span className="text-app">{formatMoney(carCostAed, "AED")}</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  Auto-filled from selected car purchase price.
                </div>
              </div>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Shipping AED</span>
                <input
                  type="number"
                  value={form.shippingAed}
                  onChange={(e) => updateField("shippingAed", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Inspection AED</span>
                <input
                  type="number"
                  value={form.inspectionAed}
                  onChange={(e) => updateField("inspectionAed", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Recovery AED</span>
                <input
                  type="number"
                  value={form.recoveryAed}
                  onChange={(e) => updateField("recoveryAed", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Maintenance AED</span>
                <input
                  type="number"
                  value={form.maintenanceAed}
                  onChange={(e) => updateField("maintenanceAed", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Other AED</span>
                <input
                  type="number"
                  value={form.otherAed}
                  onChange={(e) => updateField("otherAed", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-md border border-app bg-black px-3 py-2 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Shipping Paid</span>
                <button
                  type="button"
                  onClick={() => updateField("shippingPaid", !form.shippingPaid)}
                  className={[
                    "rounded-full border px-3 py-1 text-[11px] font-semibold transition",
                    form.shippingPaid
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-app"
                      : "border-app surface text-app",
                  ].join(" ")}
                >
                  {form.shippingPaid ? "Yes" : "No"}
                </button>
              </label>

              <div className="rounded-md border border-app bg-black px-3 py-2 text-xs text-app sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-app">Live Profit Preview</span>
                  <span className="text-[var(--color-accent)]">{formatMoney(profitPreview, "AED")}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-400">
                  <span>Total expenses</span>
                  <span>{formatMoney(totalExpenses, "AED")}</span>
                </div>
              </div>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Status</span>
                <select
                  value={form.status}
                  onChange={(e) => updateField("status", e.target.value as "pending" | "closed")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="pending">pending</option>
                  <option value="closed">closed</option>
                </select>
              </label>

              <div className="hidden sm:block" />

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Google Drive Folder Link</span>
                <input
                  type="text"
                  value={form.driveLink}
                  onChange={(e) => updateField("driveLink", e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-app surface pt-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-app bg-black px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* View Modal */}
      {viewDeal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeView} />
          <div className="relative w-full max-w-3xl rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">Deal Details</div>
                <div className="text-xs text-muted">
                  {viewDeal.client_name || "-"} • {viewDeal.car_label || "-"} •{" "}
                  {formatDate(viewDeal.date ?? viewDeal.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={closeView}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-app bg-black p-3 text-xs text-app">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-app">Sale</span>
                  <span className="text-app">{formatMoney(viewDeal.sale_dzd, "DZD")}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                  <span>Rate</span>
                  <span>{viewDeal.rate != null ? formatNumber(viewDeal.rate) : "-"}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                  <span>Sale AED</span>
                  <span>{formatMoney(viewDeal.sale_aed, "AED")}</span>
                </div>
              </div>

              <div className="rounded-md border border-app bg-black p-3 text-xs text-app">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-app">Profit</span>
                  <span className="text-[var(--color-accent)]">{formatMoney(viewDeal.profit, "AED")}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                  <span>Status</span>
                  <span className="text-app">{(viewDeal.status || "pending").toLowerCase()}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                  <span>Shipping Paid</span>
                  <span className="text-app">{viewDeal.shipping_paid ? "Yes" : "No"}</span>
                </div>
              </div>

              <div className="rounded-md border border-app bg-black p-3 text-xs text-app sm:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Expenses (AED)
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2 text-app">
                    <span className="text-muted">Car Cost</span>
                    <span>{formatMoney(viewDeal.cost_car, "AED")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-app">
                    <span className="text-muted">Shipping</span>
                    <span>{formatMoney(viewDeal.cost_shipping, "AED")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-app">
                    <span className="text-muted">Inspection</span>
                    <span>{formatMoney(viewDeal.cost_inspection, "AED")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-app">
                    <span className="text-muted">Recovery</span>
                    <span>{formatMoney(viewDeal.cost_recovery, "AED")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-app">
                    <span className="text-muted">Maintenance</span>
                    <span>{formatMoney(viewDeal.cost_maintenance, "AED")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-app">
                    <span className="text-muted">Other</span>
                    <span>{formatMoney(viewDeal.cost_other, "AED")}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-app bg-black p-3 text-xs text-app sm:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Payment history
                  </div>
                  {(viewDeal.pending_dzd ?? 0) <= 0 ? (
                    <span className="text-[11px] text-gray-400">
                      This deal has no pending payments
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsPaymentFormOpen((prev) => !prev)}
                      className="rounded-md border border-app surface px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)]/70"
                    >
                      {isPaymentFormOpen ? "Cancel" : "Add Payment"}
                    </button>
                  )}
                </div>
                <div className="mt-2 rounded-md border border-app bg-white p-2 text-[11px] text-app">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-app">Collected DZD</span>
                      <span className="mt-0.5 text-sm text-app">
                        {formatMoney(viewDeal.collected_dzd, "DZD")}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-semibold text-app">Pending DZD</span>
                      <span className="mt-0.5 text-sm text-[var(--color-accent)]">
                        {formatMoney(viewDeal.pending_dzd, "DZD")}
                      </span>
                    </div>
                  </div>
                </div>
                {isPaymentFormOpen && (
                  <div className="mt-2 flex flex-col gap-2 rounded-md border border-app bg-white p-2 text-[11px] text-app">
                    {(() => {
                      const pendingDzd = viewDeal.pending_dzd ?? 0;
                      const paymentAmount = parseNum(newPaymentAmount);
                      const exceedsPending = paymentAmount > pendingDzd;
                      const saveDisabled =
                        isAddingPayment ||
                        paymentAmount <= 0 ||
                        exceedsPending;
                      return (
                        <>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <label className="flex-1 space-y-1">
                        <span className="font-semibold text-app">Amount DZD</span>
                        <input
                          type="number"
                          value={newPaymentAmount}
                          onChange={(e) => setNewPaymentAmount(e.target.value)}
                          className="w-full rounded-md border border-app bg-black px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                        />
                        {exceedsPending && (
                          <p className="mt-1 text-red-300">
                            Payment exceeds remaining balance. Maximum:{" "}
                            {formatNumber(pendingDzd)} DZD
                          </p>
                        )}
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-app">Date</span>
                        <input
                          type="date"
                          value={newPaymentDate}
                          onChange={(e) => setNewPaymentDate(e.target.value)}
                          className="w-full rounded-md border border-app bg-black px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                        />
                      </label>
                    </div>
                    <label className="space-y-1">
                      <span className="font-semibold text-app">Notes</span>
                      <input
                        value={newPaymentNote}
                        onChange={(e) => setNewPaymentNote(e.target.value)}
                        className="w-full rounded-md border border-app bg-black px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                      />
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddPayment}
                        disabled={saveDisabled}
                        className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-[11px] font-semibold text-app disabled:opacity-50"
                      >
                        {isAddingPayment ? "Saving..." : "Save Payment"}
                      </button>
                    </div>
                        </>
                      );
                    })()}
                  </div>
                )}
                {paymentsLoading ? (
                  <div className="mt-2 text-sm text-muted">Loading payments...</div>
                ) : paymentsError ? (
                  <div className="mt-2 text-xs text-red-300">{paymentsError}</div>
                ) : payments.length === 0 ? (
                  <div className="mt-2 text-sm text-muted">No payments yet.</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-app pb-2 text-[11px] last:border-b-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-app">{formatDate(p.date ?? p.created_at)}</span>
                          <span className="text-app">
                            {formatMoney(p.dzd, "DZD")}
                          </span>
                          {p.notes ? <span className="text-gray-400">{p.notes}</span> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeletePayment(p)}
                          disabled={deletingPaymentId === p.id}
                          className="rounded border border-app bg-black px-2 py-0.5 text-[10px] font-semibold text-red-400 hover:border-red-700 disabled:opacity-50"
                        >
                          {deletingPaymentId === p.id ? "Removing..." : "Delete"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(viewDeal as Deal & { drive_link?: string | null }).drive_link ? (
                <div className="rounded-md border border-app bg-black p-3 text-xs text-app sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Google Drive
                  </div>
                  <div className="mt-2">
                    <DriveLinkIcon href={(viewDeal as Deal & { drive_link?: string | null }).drive_link ?? ""} />
                  </div>
                </div>
              ) : null}
              {viewDeal.notes ? (
                <div className="rounded-md border border-app bg-black p-3 text-xs text-app sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Notes
                  </div>
                  <div className="mt-2 text-sm text-app whitespace-pre-wrap">
                    {viewDeal.notes}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Quick Add Client modal */}
      {quickAddClientOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => !quickAddSaving && setQuickAddClientOpen(false)} />
          <div className="relative w-full max-w-sm rounded-lg border border-app surface p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-app">Add new client</h3>
            <p className="mt-1 text-xs text-muted">Name and phone only. You can add more details later in Clients.</p>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1 text-xs text-app">
                <span className="font-semibold">Name</span>
                <input
                  type="text"
                  value={quickAddName}
                  onChange={(e) => setQuickAddName(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="block space-y-1 text-xs text-app">
                <span className="font-semibold">Phone</span>
                <input
                  type="text"
                  value={quickAddPhone}
                  onChange={(e) => setQuickAddPhone(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !quickAddSaving && setQuickAddClientOpen(false)}
                className="rounded-md border border-app px-3 py-1.5 text-xs font-semibold text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleQuickAddClient}
                disabled={quickAddSaving}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-app disabled:opacity-50"
              >
                {quickAddSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

