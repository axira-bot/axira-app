"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Car, Deal } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import dynamic from "next/dynamic";
import PreorderDealModal from "@/components/preorders/PreorderDealModal";
import { useAuth } from "@/lib/context/AuthContext";

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
  passport_number?: string | null;
};

type EmployeeOption = {
  id: string;
  name: string | null;
  role: string | null;
  commission_per_deal: number | null;
  commission_per_managed_deal: number | null;
};

type DummyDocRow = {
  id: string;
  client_name: string;
  client_phone: string | null;
  client_passport: string | null;
  car_brand: string;
  car_model: string;
  car_year: number | null;
  car_color: string | null;
  car_vin: string | null;
  country_of_origin: string | null;
  invoice_date: string | null;
  agreement_date: string | null;
  amount_usd: number;
  export_to: string | null;
  notes: string | null;
  created_at: string | null;
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

function truncateMarker(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Dropdown + stored `car_label`: disambiguate duplicates with VIN tail, notes, color when present. */
function carLabel(c: Car) {
  const base = [c.brand, c.model, c.year ? String(c.year) : null].filter(Boolean).join(" ");
  const extras: string[] = [];
  const vin = (c.vin || "").trim();
  if (vin.length >= 6) extras.push(`VIN …${vin.slice(-6)}`);
  else if (vin) extras.push(`VIN ${vin}`);
  const marker = truncateMarker(c.notes || "", 36);
  if (marker) extras.push(marker);
  const color = (c.color || "").trim();
  if (color) extras.push(color);
  if (!extras.length) return base;
  return `${base} · ${extras.join(" · ")}`;
}

function formatVinShort(vin: string | null | undefined): string {
  const value = (vin || "").trim();
  if (!value) return "VIN: pending";
  const tail = value.slice(-6);
  return `...${tail}`;
}

export default function DealsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, role, isStaff } = useAuth();
  /** Cleared when URL no longer has `addDeal=1`, so the same car can be deep-linked again after `router.replace`. */
  const prefillCarIdProcessedRef = useRef<string>("");

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cars, setCars] = useState<Car[]>([]);
  const [poDealEligibility, setPoDealEligibility] = useState<"in_transit_or_arrived" | "arrived_only">(
    "in_transit_or_arrived"
  );
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
  const [isPreorderModalOpen, setIsPreorderModalOpen] = useState(false);
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
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [isDummyDocsOpen, setIsDummyDocsOpen] = useState(false);
  const [dummyDocs, setDummyDocs] = useState<DummyDocRow[]>([]);
  const [dummySaving, setDummySaving] = useState(false);
  const [dummyError, setDummyError] = useState<string | null>(null);
  const [dummyForm, setDummyForm] = useState({
    id: "",
    clientName: "",
    clientPhone: "",
    clientPassport: "",
    carBrand: "",
    carModel: "",
    carYear: "",
    carColor: "",
    carVin: "",
    countryOfOrigin: "",
    invoiceDate: "",
    agreementDate: "",
    amountUsd: "",
    exportTo: "Algeria",
    notes: "",
  });
  const [customerSearchInput, setCustomerSearchInput] = useState("");
  const [customerSearchDebounced, setCustomerSearchDebounced] = useState("");
  const [copiedVinDealId, setCopiedVinDealId] = useState<string | null>(null);
  const isPrivilegedRole = ["owner", "manager", "admin", "super_admin"].includes((role || "").toLowerCase());

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);

    const [
      { data: carsData, error: carsError },
      { data: dealsData, error: dealsError },
      { data: poEligibilityData, error: poEligibilityErr },
    ] = await Promise.all([
      supabase
        .from("cars")
        .select(
          "id, brand, model, year, purchase_price, status, client_name, color, vin, country_of_origin, notes, stock_type, supplier_name, inventory_lifecycle_status, purchase_order_id, purchase_order_item_id"
        )
        .order("created_at", { ascending: false }),
      supabase.from("deals").select("*").order("date", { ascending: false }),
      supabase.from("app_settings").select("value").eq("key", "po_deal_eligibility").maybeSingle(),
    ]);

    if (carsError || dealsError) {
      setError(
        [
          "Failed to load deals data.",
          carsError?.message,
          dealsError?.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    setCars((carsData as Car[]) ?? []);
    setDeals((dealsData as Deal[]) ?? []);
    if (!poEligibilityErr) {
      const value = ((poEligibilityData as { value?: string | null } | null)?.value || "").trim();
      if (value === "arrived_only" || value === "in_transit_or_arrived") {
        setPoDealEligibility(value);
      }
    }
    setIsLoading(false);

    // Load secondary dropdown data after first paint to improve page transition speed.
    const [
      { data: clientsData, error: clientsError },
      { data: employeesData, error: employeesError },
      dummyDocsRes,
    ] =
      await Promise.all([
        supabase.from("clients").select("id, name, phone, passport_number").order("name", { ascending: true }),
        supabase
          .from("employees")
          .select("id, name, role, commission_per_deal, commission_per_managed_deal")
          .eq("status", "active")
          .order("name", { ascending: true }),
        fetch("/api/deals/dummy-docs", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ rows: [] })),
      ]);

    if (clientsError || employeesError) {
      setError((prev) =>
        [
          prev,
          clientsError?.message ? `Clients: ${clientsError.message}` : null,
          employeesError?.message ? `Employees: ${employeesError.message}` : null,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    setClients((clientsData as ClientDeal[]) ?? []);
    setEmployees((employeesData as EmployeeOption[]) ?? []);
    setDummyDocs((dummyDocsRes?.rows as DummyDocRow[] | undefined) ?? []);
  };

  const saveDummyDoc = async () => {
    if (!dummyForm.clientName.trim()) {
      setDummyError("Client name is required.");
      return;
    }
    if (!dummyForm.carBrand.trim() || !dummyForm.carModel.trim()) {
      setDummyError("Car brand and model are required.");
      return;
    }
    const amountUsd = parseNum(dummyForm.amountUsd);
    if (amountUsd <= 0) {
      setDummyError("Amount USD must be greater than zero.");
      return;
    }
    setDummySaving(true);
    setDummyError(null);
    const editing = Boolean(dummyForm.id);
    const res = await fetch(editing ? "/api/deals/dummy-docs" : "/api/deals/dummy-docs", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: dummyForm.id || undefined,
        client_name: dummyForm.clientName,
        client_phone: dummyForm.clientPhone || null,
        client_passport: dummyForm.clientPassport || null,
        car_brand: dummyForm.carBrand,
        car_model: dummyForm.carModel,
        car_year: dummyForm.carYear ? Number(dummyForm.carYear) : null,
        car_color: dummyForm.carColor || null,
        car_vin: dummyForm.carVin || null,
        country_of_origin: dummyForm.countryOfOrigin || null,
        invoice_date: dummyForm.invoiceDate || null,
        agreement_date: dummyForm.agreementDate || null,
        amount_usd: amountUsd,
        export_to: dummyForm.exportTo || "Algeria",
        notes: dummyForm.notes || null,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDummyError(payload.error || `Failed to ${editing ? "update" : "save"} dummy document.`);
      setDummySaving(false);
      return;
    }
    const row = payload.row as DummyDocRow;
    setDummyDocs((prev) => {
      if (editing) return prev.map((x) => (x.id === row.id ? row : x));
      return [row, ...prev];
    });
    setDummyForm({
      id: "",
      clientName: "",
      clientPhone: "",
      clientPassport: "",
      carBrand: "",
      carModel: "",
      carYear: "",
      carColor: "",
      carVin: "",
      countryOfOrigin: "",
      invoiceDate: "",
      agreementDate: "",
      amountUsd: "",
      exportTo: "Algeria",
      notes: "",
    });
    setDummySaving(false);
  };

  const startEditDummyDoc = (doc: DummyDocRow) => {
    setDummyError(null);
    setDummyForm({
      id: doc.id,
      clientName: doc.client_name || "",
      clientPhone: doc.client_phone || "",
      clientPassport: doc.client_passport || "",
      carBrand: doc.car_brand || "",
      carModel: doc.car_model || "",
      carYear: doc.car_year ? String(doc.car_year) : "",
      carColor: doc.car_color || "",
      carVin: doc.car_vin || "",
      countryOfOrigin: doc.country_of_origin || "",
      invoiceDate: doc.invoice_date || "",
      agreementDate: doc.agreement_date || "",
      amountUsd: String(doc.amount_usd || ""),
      exportTo: doc.export_to || "Algeria",
      notes: doc.notes || "",
    });
  };

  const cancelEditDummyDoc = () => {
    setDummyError(null);
    setDummyForm({
      id: "",
      clientName: "",
      clientPhone: "",
      clientPassport: "",
      carBrand: "",
      carModel: "",
      carYear: "",
      carColor: "",
      carVin: "",
      countryOfOrigin: "",
      invoiceDate: "",
      agreementDate: "",
      amountUsd: "",
      exportTo: "Algeria",
      notes: "",
    });
  };

  const deleteDummyDoc = async (id: string) => {
    if (!window.confirm("Delete this dummy document?")) return;
    setDummyError(null);
    const res = await fetch(`/api/deals/dummy-docs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDummyError(payload.error || "Failed to delete dummy document.");
      return;
    }
    setDummyDocs((prev) => prev.filter((x) => x.id !== id));
    if (dummyForm.id === id) cancelEditDummyDoc();
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setCustomerSearchDebounced(customerSearchInput.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(t);
  }, [customerSearchInput]);

  const filteredDeals = useMemo(() => {
    const selectedClientId = (searchParams.get("clientId") || "").trim();
    const selectedClientName = (searchParams.get("clientName") || "").trim().toLowerCase();
    let base = deals;
    if (activeTab === "Pending") {
      base = base.filter((d) => (d.status || "pending").toLowerCase() === "pending");
    } else if (activeTab === "Closed") {
      base = base.filter((d) => (d.status || "").toLowerCase() === "closed");
    }
    if (selectedClientId) {
      base = base.filter((d) => ((d as Deal & { client_id?: string | null }).client_id || "") === selectedClientId);
    } else if (selectedClientName) {
      base = base.filter((d) => (d.client_name || "").trim().toLowerCase() === selectedClientName);
    }
    if (isStaff && user?.id) {
      base = base.filter((d) => ((d as Deal & { created_by?: string | null }).created_by || "") === user.id);
    }
    if (customerSearchDebounced) {
      base = base.filter((d) => {
        const client = clients.find((c) => c.id === (d as Deal & { client_id?: string | null }).client_id);
        const name = (d.client_name || "").toLowerCase();
        const phone = (client?.phone || "").toLowerCase();
        const passport = (client?.passport_number || "").toLowerCase();
        return (
          name.includes(customerSearchDebounced) ||
          phone.includes(customerSearchDebounced) ||
          passport.includes(customerSearchDebounced)
        );
      });
    }
    return base;
  }, [activeTab, deals, searchParams, isStaff, user?.id, customerSearchDebounced, clients]);

  const pendingCompletionCount = useMemo(
    () =>
      deals.filter(
        (d) => Boolean((d as Deal & { pending_completion?: boolean | null }).pending_completion)
      ).length,
    [deals]
  );

  const usedCarIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of deals) {
      if (d.car_id) ids.add(d.car_id);
    }
    return ids;
  }, [deals]);

  useEffect(() => {
    if (searchParams.get("addDeal") !== "1") {
      prefillCarIdProcessedRef.current = "";
    }
  }, [searchParams]);

  const isPoCarEligibleForDeal = (car: Car): boolean => {
    if (!car.purchase_order_id) return true;
    const lifecycle = (car.inventory_lifecycle_status || "").toUpperCase();
    const availability = (car.status || "").toLowerCase();
    if (poDealEligibility === "arrived_only") {
      return lifecycle === "ARRIVED" || lifecycle === "IN_STOCK" || availability === "available";
    }
    return (
      lifecycle === "IN_TRANSIT" ||
      lifecycle === "INCOMING" ||
      lifecycle === "ARRIVED" ||
      lifecycle === "IN_STOCK" ||
      availability === "in_transit" ||
      availability === "available"
    );
  };

  // Inventory → Deals: ?addDeal=1&carId=uuid (strip query after handling; dedupe strict double-invoke)
  useEffect(() => {
    const addDeal = searchParams.get("addDeal");
    const carIdParam = searchParams.get("carId")?.trim();
    if (addDeal !== "1" || !carIdParam) return;
    if (isLoading) return;
    if (prefillCarIdProcessedRef.current === carIdParam) return;

    prefillCarIdProcessedRef.current = carIdParam;
    router.replace("/deals", { scroll: false });

    const car = cars.find((c) => c.id === carIdParam);
    if (!car) {
      setError("Car not found or unavailable.");
      return;
    }
    if (car.stock_type === "supplier" && !car.purchase_order_id) {
      setError(
        "Supplier listings cannot be used for deals. Convert the car to AXIRA Stock in Inventory first, then create the deal."
      );
      return;
    }
    if (!isPoCarEligibleForDeal(car)) {
      setError("This purchase-order car is not eligible for deals under current PO setting.");
      return;
    }
    if (usedCarIds.has(car.id)) {
      setError("This car already has a deal. Open the existing deal or choose another car.");
      return;
    }

    setEditingDealId(null);
    setForm({ ...emptyForm(), carId: car.id });
    setIsModalOpen(true);
    setError(null);
  }, [isLoading, cars, searchParams, router, usedCarIds, poDealEligibility]);

  const availableCars = useMemo(() => {
    return cars.filter((c) => {
      if (!c.id) return false;
      if (editingDealId) {
        const editingDeal = deals.find((d) => d.id === editingDealId);
        if (editingDeal && editingDeal.car_id === c.id) {
          return true;
        }
      }
      if (!isPoCarEligibleForDeal(c)) return false;
      return !usedCarIds.has(c.id);
    });
  }, [cars, deals, usedCarIds, editingDealId, poDealEligibility]);

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
    setClientDropdownOpen(false);
    setClientSearchQuery(newClient.name?.trim() || "");
  };

  const updateField = <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.clientId.trim()) return "Client is required.";
    if (!clients.some((c) => c.id === form.clientId)) {
      return "Select a valid client from the list, or add a new client before saving.";
    }
    if (!form.date) return "Date is required.";
    if (!form.carId) return "Car is required.";
    if (!form.saleDzd.trim()) return "Sale Price DZD is required.";
    if (!isStaff) {
      if (!form.rate.trim()) return "Rate at Deal is required.";
      if (rate <= 0) return "Rate at Deal must be > 0.";
    }
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
      created_by: user?.id || null,
      pending_completion: isStaff ? true : false,
    };

    if (editingDealId) {
      const existingDeal = deals.find((d) => d.id === editingDealId);
      const existingExt = existingDeal as (Deal & { handled_by?: string | null }) | undefined;
      const previousEmployeeId = existingExt?.handled_by ?? null;
      const newEmployeeId = form.employeeId || null;

      const staffPayload = {
        notes: payload.notes,
        collected_dzd: payload.collected_dzd,
        pending_dzd: payload.pending_dzd,
        status: payload.status,
      };
      const staffRes = isStaff
        ? await fetch(`/api/deals/${editingDealId}/staff-update`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(staffPayload),
          })
        : null;
      const updateError = isStaff
        ? (!staffRes || !staffRes.ok ? new Error((await staffRes?.json().catch(() => ({})))?.error || "Failed to update deal") : null)
        : (await supabase.from("deals").update(payload).eq("id", editingDealId)).error;
      if (updateError) {
        const updateDetails =
          typeof updateError === "object" && updateError && "details" in updateError
            ? String((updateError as { details?: unknown }).details || "")
            : null;
        const updateHint =
          typeof updateError === "object" && updateError && "hint" in updateError
            ? String((updateError as { hint?: unknown }).hint || "")
            : null;
        // eslint-disable-next-line no-console
        console.log("Supabase deal update error:", updateError);
        setError(
          [
            "Failed to update deal.",
            updateError.message,
            updateDetails,
            updateHint,
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
                  currency: "DZD",
                  rate_snapshot: rate > 0 ? rate : null,
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
                currency: "DZD",
                rate_snapshot: rate > 0 ? rate : null,
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
      const insertedRes = isStaff
        ? await fetch("/api/deals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : null;
      const directInsert = !isStaff
        ? await supabase
            .from("deals")
            .insert(payload)
            .select("*")
            .single()
        : null;
      const insertedPayload = isStaff
        ? await insertedRes?.json().catch(() => ({}))
        : null;
      const inserted = isStaff ? insertedPayload?.row : directInsert?.data;
      const insertError = isStaff
        ? (!insertedRes || !insertedRes.ok ? new Error(insertedPayload?.error || "Failed to create deal") : null)
        : directInsert?.error ?? null;
      if (insertError) {
        const insertDetails =
          typeof insertError === "object" && insertError && "details" in insertError
            ? String((insertError as { details?: unknown }).details || "")
            : null;
        const insertHint =
          typeof insertError === "object" && insertError && "hint" in insertError
            ? String((insertError as { hint?: unknown }).hint || "")
            : null;
        // eslint-disable-next-line no-console
        console.log("Supabase deal insert error:", insertError);
        setError(
          [
            "Failed to add deal.",
            insertError.message,
            insertDetails,
            insertHint,
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
        .update({ status: "sold", display_status: "sold", sold_at: new Date().toISOString() })
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
                currency: "DZD",
                rate_snapshot: rate > 0 ? rate : null,
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

    // Reset car display_status back to available when deal is deleted
    if (deal.car_id) {
      await supabase
        .from("cars")
        .update({ status: "available", display_status: "available", sold_at: null })
        .eq("id", deal.car_id);
    }

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

  const handleLifecycleTransition = async (toStatus: "ORDERED" | "SHIPPED" | "ARRIVED" | "CLOSED" | "CANCELLED") => {
    if (!viewDeal) return;
    setLifecycleSaving(true);
    setPaymentsError(null);
    const res = await fetch(`/api/deals/${encodeURIComponent(viewDeal.id)}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_status: toStatus }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPaymentsError(data.error || "Failed to update lifecycle.");
      setLifecycleSaving(false);
      return;
    }
    const legacyStatus = toStatus === "CLOSED" ? "closed" : "pending";
    setViewDeal((prev) =>
      prev ? { ...prev, lifecycle_status: toStatus, status: legacyStatus } : prev
    );
    setDeals((prev) =>
      prev.map((d) =>
        d.id === viewDeal.id ? { ...d, lifecycle_status: toStatus, status: legacyStatus } : d
      )
    );
    setLifecycleSaving(false);
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Deals</h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">Sales & Profit</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsPreorderModalOpen(true)}
              className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            >
              Add Pre-Order
            </button>
            <button
              type="button"
              onClick={() => {
                setDummyError(null);
                setIsDummyDocsOpen(true);
              }}
              className="inline-flex items-center justify-center rounded-md border border-app bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Dummy Docs
            </button>
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Add Deal
            </button>
          </div>
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
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-[#C41230]/70",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </div>
        {(searchParams.get("clientId") || searchParams.get("clientName")) && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Filtered by client</span>
            <button
              type="button"
              onClick={() => router.replace("/deals")}
              className="rounded-md border border-app bg-white px-2 py-1 font-semibold text-app"
            >
              Clear filter
            </button>
          </div>
        )}

        <div className="rounded-lg border border-app surface p-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <input
              type="text"
              value={customerSearchInput}
              onChange={(e) => setCustomerSearchInput(e.target.value)}
              placeholder="Search customer name, passport, or phone"
              className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            />
            <div className="text-xs font-semibold text-muted">
              Results: <span className="text-app">{filteredDeals.length}</span>
            </div>
          </div>
        </div>

        {!isStaff && pendingCompletionCount > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Pending Completion queue: <strong>{pendingCompletionCount}</strong> deal(s) need manager internal completion.
          </div>
        )}

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
              <table className="min-w-[680px] w-full text-left text-xs">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Car</th>
                    <th className="px-4 py-3">VIN</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Sale DZD</th>
                    {!isStaff && <th className="px-4 py-3 hidden sm:table-cell">Rate</th>}
                    {!isStaff && <th className="px-4 py-3">Sale AED</th>}
                    {!isStaff && <th className="px-4 py-3 hidden sm:table-cell">Total Expenses</th>}
                    {!isStaff && <th className="px-4 py-3">Profit</th>}
                    {!isStaff && <th className="px-4 py-3 hidden md:table-cell">Source</th>}
                    {!isStaff && <th className="px-4 py-3 hidden md:table-cell">Lifecycle</th>}
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
                        <td className="px-4 py-3 text-app">
                          {(() => {
                            const dealCar = cars.find((c) => c.id === d.car_id);
                            const fullVin = (dealCar?.vin || "").trim();
                            const shortVin = formatVinShort(fullVin);
                            if (!fullVin) return <span className="text-muted">VIN: pending</span>;
                            return (
                              <button
                                type="button"
                                title={fullVin}
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(fullVin);
                                    setCopiedVinDealId(d.id);
                                    setTimeout(() => setCopiedVinDealId((prev) => (prev === d.id ? null : prev)), 1200);
                                  } catch {
                                    setError("Failed to copy VIN.");
                                  }
                                }}
                                className="rounded border border-app bg-white px-2 py-1 text-[11px] font-semibold text-app hover:bg-gray-50"
                              >
                                {copiedVinDealId === d.id ? "Copied" : shortVin}
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-app">{formatDate(d.date ?? d.created_at)}</td>
                        <td className="px-4 py-3 text-app">{formatMoney(d.sale_dzd, "DZD")}</td>
                        {!isStaff && <td className="px-4 py-3 text-app hidden sm:table-cell">{d.rate != null ? formatNumber(d.rate) : "-"}</td>}
                        {!isStaff && <td className="px-4 py-3 text-app">{formatMoney(d.sale_aed, "AED")}</td>}
                        {!isStaff && <td className="px-4 py-3 text-app hidden sm:table-cell">{formatMoney(total, "AED")}</td>}
                        {!isStaff && <td className="px-4 py-3 font-semibold text-[var(--color-accent)]">{formatMoney(d.profit, "AED")}</td>}
                        {!isStaff && <td className="px-4 py-3 text-app hidden md:table-cell">{((d as Deal & { source?: string | null }).source || "STOCK").toString()}</td>}
                        {!isStaff && <td className="px-4 py-3 text-app hidden md:table-cell">{((d as Deal & { lifecycle_status?: string | null }).lifecycle_status || (status === "closed" ? "CLOSED" : "PRE_ORDER")).toString()}</td>}
                        <td className="px-4 py-3">
                          <span
                            className={[
                              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              status === "closed"
                                ? "border-gray-300 bg-gray-100 text-gray-600"
                                : "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-white",
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
                              disabled={isStaff && !isPrivilegedRole}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(d)}
                              disabled={isStaff || isDeletingId === d.id}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
                            >
                              {isDeletingId === d.id ? "Deleting..." : "Delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => openView(d)}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
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

              <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-app">Pending DZD</span>
                  <span className="text-app">{formatMoney(pendingDzd, "DZD")}</span>
                </div>
              </div>

              {!isStaff && (
                <>
                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">Rate at Deal (DZD/AED)</span>
                    <input
                      type="number"
                      value={form.rate}
                      onChange={(e) => updateField("rate", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>

                  <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-app">Sale AED</span>
                      <span className="text-app">{formatMoney(saleAed, "AED")}</span>
                    </div>
                  </div>
                </>
              )}

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

              {!isStaff && (
                <>
                  <div className="sm:col-span-2">
                    <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Expenses (AED)
                    </div>
                  </div>

                  <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
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

                  <label className="flex items-center justify-between gap-3 rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                    <span className="font-semibold">Shipping Paid</span>
                    <button
                      type="button"
                      onClick={() => updateField("shippingPaid", !form.shippingPaid)}
                      className={[
                        "rounded-full border px-3 py-1 text-[11px] font-semibold transition",
                        form.shippingPaid
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
                          : "border-app surface text-app",
                      ].join(" ")}
                    >
                      {form.shippingPaid ? "Yes" : "No"}
                    </button>
                  </label>

                  <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-app">Live Profit Preview</span>
                      <span className="text-[var(--color-accent)]">{formatMoney(profitPreview, "AED")}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-400">
                      <span>Total expenses</span>
                      <span>{formatMoney(totalExpenses, "AED")}</span>
                    </div>
                  </div>
                </>
              )}

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
                className="rounded-md border border-app bg-white px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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
                <div className="mt-2 text-xs text-app">
                  {(() => {
                    const dealCar = cars.find((c) => c.id === viewDeal.car_id);
                    const fullVin = (dealCar?.vin || "").trim();
                    if (!fullVin) return <span className="text-muted">VIN: pending</span>;
                    return (
                      <button
                        type="button"
                        title={fullVin}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(fullVin);
                            setCopiedVinDealId(viewDeal.id);
                            setTimeout(() => setCopiedVinDealId((prev) => (prev === viewDeal.id ? null : prev)), 1200);
                          } catch {
                            setError("Failed to copy VIN.");
                          }
                        }}
                        className="rounded border border-app bg-white px-2 py-1 text-[11px] font-semibold text-app hover:bg-gray-50"
                      >
                        {copiedVinDealId === viewDeal.id ? "Copied" : formatVinShort(fullVin)}
                      </button>
                    );
                  })()}
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
              <div className="rounded-md border border-app bg-white p-3 text-xs text-app">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-app">Sale</span>
                  <span className="text-app">{formatMoney(viewDeal.sale_dzd, "DZD")}</span>
                </div>
                {!isStaff && (
                  <>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                      <span>Rate</span>
                      <span>{viewDeal.rate != null ? formatNumber(viewDeal.rate) : "-"}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                      <span>Sale AED</span>
                      <span>{formatMoney(viewDeal.sale_aed, "AED")}</span>
                    </div>
                  </>
                )}
              </div>

              {!isStaff ? (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app">
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
              ) : (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-app">Status</span>
                    <span className="text-app">{(viewDeal.status || "pending").toLowerCase()}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                    <span>Shipping Paid</span>
                    <span className="text-app">{viewDeal.shipping_paid ? "Yes" : "No"}</span>
                  </div>
                </div>
              )}

              {!isStaff && (
              <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
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
              )}

              <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
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
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
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
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                        />
                      </label>
                    </div>
                    <label className="space-y-1">
                      <span className="font-semibold text-app">Notes</span>
                      <input
                        value={newPaymentNote}
                        onChange={(e) => setNewPaymentNote(e.target.value)}
                        className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                      />
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddPayment}
                        disabled={saveDisabled}
                        className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
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
                          className="rounded border border-app bg-white px-2 py-0.5 text-[10px] font-semibold text-red-400 hover:border-red-700 disabled:opacity-50"
                        >
                          {deletingPaymentId === p.id ? "Removing..." : "Delete"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(viewDeal.source === "PRE_ORDER_CATALOG" || viewDeal.source === "PRE_ORDER_CUSTOM") && (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Pre-order lifecycle</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["ORDERED", "SHIPPED", "ARRIVED", "CLOSED", "CANCELLED"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handleLifecycleTransition(status)}
                        disabled={lifecycleSaving}
                        className="rounded border border-app bg-white px-2 py-1 text-[10px] font-semibold text-app hover:border-[var(--color-accent)] disabled:opacity-50"
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-muted">
                    Current: {(viewDeal.lifecycle_status || "PRE_ORDER").toUpperCase()}
                  </div>
                </div>
              )}

              {(viewDeal as Deal & { drive_link?: string | null }).drive_link ? (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Google Drive
                  </div>
                  <div className="mt-2">
                    <DriveLinkIcon href={(viewDeal as Deal & { drive_link?: string | null }).drive_link ?? ""} />
                  </div>
                </div>
              ) : null}
              {viewDeal.notes ? (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
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
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {quickAddSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PreorderDealModal
        open={isPreorderModalOpen}
        onClose={() => setIsPreorderModalOpen(false)}
        onCreated={fetchAll}
      />

      {isDummyDocsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setIsDummyDocsOpen(false)} />
          <div className="relative flex w-full max-w-4xl max-h-screen flex-col overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">Dummy Invoice + Agreement</div>
                <div className="text-xs text-muted">For client-loaded cars without creating full sale deals.</div>
              </div>
              <button type="button" onClick={() => setIsDummyDocsOpen(false)} className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app">Close</button>
            </div>
            {dummyError ? <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{dummyError}</div> : null}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input placeholder="Client name" value={dummyForm.clientName} onChange={(e) => setDummyForm((p) => ({ ...p, clientName: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Client phone" value={dummyForm.clientPhone} onChange={(e) => setDummyForm((p) => ({ ...p, clientPhone: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Passport / ID" value={dummyForm.clientPassport} onChange={(e) => setDummyForm((p) => ({ ...p, clientPassport: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Car brand" value={dummyForm.carBrand} onChange={(e) => setDummyForm((p) => ({ ...p, carBrand: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Car model" value={dummyForm.carModel} onChange={(e) => setDummyForm((p) => ({ ...p, carModel: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Year" value={dummyForm.carYear} onChange={(e) => setDummyForm((p) => ({ ...p, carYear: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Color" value={dummyForm.carColor} onChange={(e) => setDummyForm((p) => ({ ...p, carColor: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="VIN" value={dummyForm.carVin} onChange={(e) => setDummyForm((p) => ({ ...p, carVin: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Country of origin" value={dummyForm.countryOfOrigin} onChange={(e) => setDummyForm((p) => ({ ...p, countryOfOrigin: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <label className="space-y-1">
                <span className="text-[11px] text-muted">Invoice date</span>
                <input type="date" value={dummyForm.invoiceDate} onChange={(e) => setDummyForm((p) => ({ ...p, invoiceDate: e.target.value }))} className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted">Agreement date</span>
                <input type="date" value={dummyForm.agreementDate} onChange={(e) => setDummyForm((p) => ({ ...p, agreementDate: e.target.value }))} className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              </label>
              <input placeholder="Amount USD" value={dummyForm.amountUsd} onChange={(e) => setDummyForm((p) => ({ ...p, amountUsd: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder="Export to" value={dummyForm.exportTo} onChange={(e) => setDummyForm((p) => ({ ...p, exportTo: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app sm:col-span-2" />
              <textarea placeholder="Notes" value={dummyForm.notes} onChange={(e) => setDummyForm((p) => ({ ...p, notes: e.target.value }))} rows={2} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app sm:col-span-2" />
            </div>
            <div className="mt-3 flex justify-end">
              {dummyForm.id ? (
                <button type="button" onClick={cancelEditDummyDoc} className="mr-2 rounded-md border border-app px-4 py-2 text-sm font-semibold text-app">
                  Cancel edit
                </button>
              ) : null}
              <button type="button" onClick={saveDummyDoc} disabled={dummySaving} className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {dummySaving ? "Saving..." : dummyForm.id ? "Update Dummy Doc" : "Save Dummy Doc"}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {dummyDocs.slice(0, 12).map((doc) => {
                const date = formatDate(doc.created_at);
                const invoiceNumber = `DINV-${doc.id.slice(0, 8).toUpperCase()}`;
                const invoiceDate = formatDate(doc.invoice_date || doc.created_at);
                const agreementDate = formatDate(doc.agreement_date || doc.created_at);
                return (
                  <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-app bg-white px-3 py-2 text-xs text-app">
                    <div>
                      {doc.client_name} - {doc.car_brand} {doc.car_model} ({date})
                      <div className="text-[10px] text-muted">Invoice: {invoiceDate} · Agreement: {agreementDate}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => startEditDummyDoc(doc)} className="rounded border border-app px-2 py-1 text-[11px] font-semibold text-app hover:bg-gray-50">
                        Edit
                      </button>
                      <button type="button" onClick={() => deleteDummyDoc(doc.id)} className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50">
                        Delete
                      </button>
                      <InvoiceDownloadButton
                        filename={`Dummy-Invoice-${doc.client_name}-${invoiceDate}.pdf`}
                        data={{ invoiceNumber, date: invoiceDate, clientName: doc.client_name, carBrand: doc.car_brand, carModel: doc.car_model, carYear: doc.car_year, carColor: doc.car_color, carVin: doc.car_vin, countryOfOrigin: doc.country_of_origin, saleUsd: doc.amount_usd, exportTo: doc.export_to || "Algeria" }}
                      />
                      <AgreementDownloadButton
                        filename={`Dummy-Agreement-${doc.client_name}-${agreementDate}.pdf`}
                        data={{ date: agreementDate, clientName: doc.client_name, clientPassport: doc.client_passport, carBrand: doc.car_brand, carModel: doc.car_model, carYear: doc.car_year, carColor: doc.car_color, carVin: doc.car_vin, countryOfOrigin: doc.country_of_origin, totalAmountUsd: doc.amount_usd, advanceUsd: 0, balanceUsd: doc.amount_usd }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

