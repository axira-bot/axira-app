"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Chip, Spinner } from "@heroui/react";
import type { Car, Deal } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import dynamic from "next/dynamic";
import PreorderDealModal from "@/components/preorders/PreorderDealModal";
import type { PreorderForm } from "@/components/preorders/types";
import { useAuth } from "@/lib/context/AuthContext";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { PageContainer } from "@/components/ui/page-container";
import { getRates, type AppRates } from "@/lib/rates";
import {
  aedToCurrency,
  computeDealCore,
  dbDealExpenseToFact,
  displayFxFromAppRates,
  mergeDealWithDerived,
  saleDzdRateToAedFromDzdPerAed,
  toAed,
  usdPerAedFromAppUsdSetting,
} from "@/lib/finance/dealMoney";
import {
  carPurchaseToCostFact,
  dealListSaleDzd,
  expensesByTypeToFormFields,
  formLinesToExpenseFacts,
  rateFieldFromDealWithDashboardFallback,
  withDealSaleRateDashboardFallback,
  type DealExpenseRow,
} from "@/app/deals/dealFinanceHelpers";
import PreGenerationModal from "@/components/contracts/PreGenerationModal";
import {
  DEFAULT_MODAL_VALUES,
  buildValidationSchema,
  type DocumentMode,
  type ModalFormValues,
  type PrefillMeta,
} from "@/lib/contracts/modalFields";
import { displayCarLifecycle } from "@/lib/cars/carLifecycleStatus";
import { dealLifecycleLabel } from "@/lib/i18n/enumLabels";
import { formatDateForLocale, formatNumberForLocale, useI18n } from "@/lib/context/I18nContext";

const InvoiceDownloadButton = dynamic(
  () => import("@/components/PDFButtons").then((m) => m.InvoiceDownloadButton),
  { ssr: false }
);
const AgreementDownloadButton = dynamic(
  () => import("@/components/PDFButtons").then((m) => m.AgreementDownloadButton),
  { ssr: false }
);

function resolveDealLinkedCar(deal: Deal | null, list: Car[]): Car | undefined {
  if (!deal) return undefined;
  if (deal.car_id) {
    const byCarId = list.find((c) => c.id === deal.car_id);
    if (byCarId) return byCarId;
  }
  if (deal.inventory_car_id) {
    return list.find((c) => c.id === deal.inventory_car_id);
  }
  return undefined;
}

type DealPayment = {
  id: string;
  deal_id: string;
  dzd: number | null;
  amount: number | null;
  currency: string | null;
  rate_to_aed: number | null;
  date: string | null;
  type: string | null;
  rate: number | null;
  notes: string | null;
  created_at?: string | null;
};

type GeneratedDocumentRow = {
  id: string;
  deal_id: string;
  payment_id: string | null;
  document_type: "agreement" | "receipt";
  file_url: string;
  generated_at: string;
  generated_by: string;
  generated_by_name?: string;
};

function paymentAmountDzd(p: DealPayment): number {
  const cur = (p.currency || "DZD").toUpperCase();
  const raw = p.amount ?? p.dzd ?? 0;
  return cur === "DZD" ? Number(raw) : Number(p.dzd ?? 0);
}

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
  shippingUsd: string;
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
  shippingUsd: "",
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

type FilterTab = "All" | "Pending" | "Closed";

function parseNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
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

export default function DealsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, role, isStaff, canDelete, isInvestorReadOnly } = useAuth();
  /** Cleared when URL no longer has `addDeal=1`, so the same car can be deep-linked again after `router.replace`. */
  const prefillCarIdProcessedRef = useRef<string>("");
  const preorderPrefillProcessedRef = useRef<string>("");
  const [preorderLockedPricing, setPreorderLockedPricing] = useState(false);
  const [preorderLockSourceCustom, setPreorderLockSourceCustom] = useState(false);
  const [preorderFormSeed, setPreorderFormSeed] = useState<Partial<PreorderForm> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cars, setCars] = useState<Car[]>([]);
  const [poDealEligibility, setPoDealEligibility] = useState<"in_transit_or_arrived" | "arrived_only">(
    "in_transit_or_arrived"
  );
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealExpensesByDealId, setDealExpensesByDealId] = useState<Record<string, DealExpenseRow[]>>({});
  const [clients, setClients] = useState<ClientDeal[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [rates, setRates] = useState<AppRates>({ DZD: 0, EUR: 0, USD: 0, GBP: 0 });

  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [quickAddClientOpen, setQuickAddClientOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddPhone, setQuickAddPhone] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<FilterTab>("All");
  const [dealsPage, setDealsPage] = useState(1);
  const [dealsPageSize, setDealsPageSize] = useState(10);

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
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocumentRow[]>([]);
  const [generatedDocsLoading, setGeneratedDocsLoading] = useState(false);
  const [selectedReceiptPaymentId, setSelectedReceiptPaymentId] = useState<string>("");
  const [isGeneratingAgreement, setIsGeneratingAgreement] = useState(false);
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [showPreGenModal, setShowPreGenModal] = useState(false);
  const [preGenMode, setPreGenMode] = useState<DocumentMode>("agreement");
  const [preGenValues, setPreGenValues] = useState<ModalFormValues>(DEFAULT_MODAL_VALUES);
  const [preGenMeta, setPreGenMeta] = useState<PrefillMeta>({ dealSource: null, hasCarId: false });
  const [preGenErrors, setPreGenErrors] = useState<Partial<Record<keyof ModalFormValues, string>>>({});
  const [preGenLoading, setPreGenLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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

  const { t, locale } = useI18n();
  const fmtNum = useCallback(
    (n: number, o?: Intl.NumberFormatOptions) =>
      formatNumberForLocale(locale, n, { maximumFractionDigits: 0, ...o }),
    [locale]
  );
  const fmtMoney = useCallback(
    (v: number | null | undefined, currency: string) =>
      `${fmtNum(typeof v === "number" && !Number.isNaN(v) ? v : 0)} ${currency}`,
    [fmtNum]
  );
  const fmtDate = useCallback(
    (value: string | null | undefined) => {
      if (!value) return t("common.emiDash");
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return t("common.emiDash");
      return formatDateForLocale(locale, value, { day: "2-digit", month: "short", year: "numeric" });
    },
    [locale, t]
  );
  const vinShortUi = useCallback(
    (vin: string | null | undefined) => {
      const value = (vin || "").trim();
      if (!value) return t("deals.vinPending");
      const tail = value.slice(-6);
      return t("deals.vinShort", { tail });
    },
    [t]
  );
  const filterTabLabel = useCallback(
    (tab: FilterTab) =>
      tab === "All" ? t("deals.filterTabAll") : tab === "Pending" ? t("deals.filterTabPending") : t("deals.filterTabClosed"),
    [t]
  );

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
          "id, brand, model, year, purchase_price, purchase_currency, purchase_rate, status, client_name, color, vin, country_of_origin, notes, stock_type, supplier_name, supplier_id, inventory_lifecycle_status, lifecycle_status, purchase_order_id, purchase_order_item_id, linked_deal_id, sale_price_dzd, sales_lead_time_days, sales_deposit_dzd, sales_internal_note, sales_cost_estimate_dzd, sales_notes, sales_notes_updated_at, sales_notes_updated_by"
        )
        .order("created_at", { ascending: false }),
      supabase.from("deals").select("*").order("date", { ascending: false }),
      supabase.from("app_settings").select("value").eq("key", "po_deal_eligibility").maybeSingle(),
    ]);

    if (carsError || dealsError) {
      setError(
        [
          t("deals.loadFailed"),
          carsError?.message,
          dealsError?.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    setCars((carsData as Car[]) ?? []);
    const dealRows = (dealsData as Deal[]) ?? [];
    setDeals(dealRows);
    const dealIds = dealRows.map((d) => d.id).filter(Boolean);
    if (dealIds.length) {
      const { data: exData } = await supabase.from("deal_expenses").select("*").in("deal_id", dealIds);
      const map: Record<string, DealExpenseRow[]> = {};
      for (const r of (exData as DealExpenseRow[]) ?? []) {
        const did = String((r as { deal_id?: string }).deal_id || "");
        if (!did) continue;
        if (!map[did]) map[did] = [];
        map[did].push(r as DealExpenseRow);
      }
      setDealExpensesByDealId(map);
    } else {
      setDealExpensesByDealId({});
    }
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
          clientsError?.message ? t("deals.loadClientsErr", { message: clientsError.message }) : null,
          employeesError?.message ? t("deals.loadEmployeesErr", { message: employeesError.message }) : null,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    setClients((clientsData as ClientDeal[]) ?? []);
    setEmployees((employeesData as EmployeeOption[]) ?? []);
    setDummyDocs((dummyDocsRes?.rows as DummyDocRow[] | undefined) ?? []);
    const latestRates = await getRates();
    setRates(latestRates);
  };

  const saveDummyDoc = async () => {
    if (!dummyForm.clientName.trim()) {
      setDummyError(t("deals.dummyClientNameRequired"));
      return;
    }
    if (!dummyForm.carBrand.trim() || !dummyForm.carModel.trim()) {
      setDummyError(t("deals.dummyCarRequired"));
      return;
    }
    const amountUsd = parseNum(dummyForm.amountUsd);
    if (amountUsd <= 0) {
      setDummyError(t("deals.dummyAmountRequired"));
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
      setDummyError(payload.error || (editing ? t("deals.dummyUpdateFailed") : t("deals.dummyCreateFailed")));
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
    if (!canDelete) return;
    if (!window.confirm(t("deals.dummyDeleteConfirm"))) return;
    setDummyError(null);
    const res = await fetch(`/api/deals/dummy-docs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDummyError(payload.error || t("deals.dummyDeleteFailed"));
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

  const fxList = useMemo(
    () => displayFxFromAppRates({ USD: rates.USD, DZD: rates.DZD, EUR: rates.EUR }),
    [rates.USD, rates.DZD, rates.EUR]
  );

  const appRatesSlice = useMemo(
    () => ({ USD: rates.USD, DZD: rates.DZD, EUR: rates.EUR }),
    [rates.USD, rates.DZD, rates.EUR]
  );

  const dealsWithDerived = useMemo(() => {
    return deals.map((d) => {
      const ex = (dealExpensesByDealId[d.id] ?? []).map((r) => dbDealExpenseToFact(r));
      const row = withDealSaleRateDashboardFallback(d, appRatesSlice);
      return mergeDealWithDerived(row, ex, fxList);
    });
  }, [deals, dealExpensesByDealId, fxList, appRatesSlice]);

  const viewDealDerived = useMemo(() => {
    if (!viewDeal) return null;
    const ex = (dealExpensesByDealId[viewDeal.id] ?? []).map((r) => dbDealExpenseToFact(r));
    const row = withDealSaleRateDashboardFallback(viewDeal, appRatesSlice);
    return mergeDealWithDerived(row, ex, fxList);
  }, [viewDeal, dealExpensesByDealId, fxList, appRatesSlice]);

  const filteredDeals = useMemo(() => {
    const selectedClientId = (searchParams.get("clientId") || "").trim();
    const selectedClientName = (searchParams.get("clientName") || "").trim().toLowerCase();
    let base = dealsWithDerived;
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
    if ((role || "").toLowerCase() === "staff" && user?.id) {
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
  }, [activeTab, dealsWithDerived, searchParams, role, user?.id, customerSearchDebounced, clients]);

  const pagedDeals = useMemo(() => {
    const start = (dealsPage - 1) * dealsPageSize;
    return filteredDeals.slice(start, start + dealsPageSize);
  }, [filteredDeals, dealsPage]);

  const dealsPages = Math.max(1, Math.ceil(filteredDeals.length / dealsPageSize));

  useEffect(() => {
    if (dealsPage > dealsPages) setDealsPage(dealsPages);
  }, [dealsPage, dealsPages]);

  useEffect(() => {
    setDealsPage(1);
  }, [activeTab, customerSearchDebounced, dealsPageSize]);

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
      return lifecycle === "ARRIVED" || lifecycle === "IN_STOCK" || lifecycle === "READY_TO_SHIP" || availability === "available";
    }
    return (
      lifecycle === "IN_TRANSIT" ||
      lifecycle === "INCOMING" ||
      lifecycle === "ARRIVED" ||
      lifecycle === "READY_TO_SHIP" ||
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
      setError(t("deals.carNotFound"));
      return;
    }
    if (car.stock_type === "supplier" && !car.purchase_order_id) {
      setError(t("deals.supplierListingNoDeal"));
      return;
    }
    if (!isPoCarEligibleForDeal(car)) {
      setError(t("deals.poCarNotEligible"));
      return;
    }
    if (usedCarIds.has(car.id)) {
      setError(t("deals.carAlreadyHasDeal"));
      return;
    }

    const poBacked = Boolean(car.purchase_order_id);
    const listDzd =
      car.sale_price_dzd != null && car.sale_price_dzd !== undefined
        ? String(car.sale_price_dzd)
        : null;

    setEditingDealId(null);
    setForm(
      poBacked && listDzd
        ? { ...emptyForm(), carId: car.id, saleDzd: listDzd, amountReceivedDzd: listDzd }
        : { ...emptyForm(), carId: car.id }
    );
    setIsModalOpen(true);
    setError(null);
  }, [isLoading, cars, searchParams, router, usedCarIds, poDealEligibility, t]);

  useEffect(() => {
    if (searchParams.get("preorder") !== "1") {
      preorderPrefillProcessedRef.current = "";
    }
  }, [searchParams]);

  // Sales list → Deals: ?preorder=1&inventoryCarId=uuid | ?preorder=1&salesCatalogId=uuid
  useEffect(() => {
    const pre = searchParams.get("preorder");
    const invId = searchParams.get("inventoryCarId")?.trim();
    const catId = searchParams.get("salesCatalogId")?.trim();
    if (pre !== "1" || (!invId && !catId)) return;
    if (isLoading) return;

    const key = invId ? `inv:${invId}` : `cat:${catId}`;
    if (preorderPrefillProcessedRef.current === key) return;

    preorderPrefillProcessedRef.current = key;
    router.replace("/deals", { scroll: false });

    void (async () => {
      try {
        const rt = rates.DZD > 0 ? rates : await getRates();
        const fx = displayFxFromAppRates(rt);
        const dzdPerAed = Math.max(rt.DZD || 0, 1);

        if (invId) {
          const car = cars.find((c) => c.id === invId);
          if (!car) {
            setError(t("deals.carNotFoundPreorder"));
            return;
          }
          const cost = carPurchaseToCostFact(car, rt);
          let sourceRateToDzd = "1";
          if (cost.currency === "USD" && fx.aedPerDzd > 0 && fx.aedPerUsd > 0) {
            sourceRateToDzd = String(Math.max(fx.aedPerUsd / fx.aedPerDzd, 0.01));
          } else if (cost.currency === "DZD") {
            sourceRateToDzd = String(Math.max(1 / Math.max(cost.rateToAed, 1e-6), 0.01));
          } else if (cost.currency === "AED") {
            sourceRateToDzd = String(dzdPerAed);
          }

          const seed: Partial<PreorderForm> = {
            source: "PRE_ORDER_CUSTOM",
            supplierId: (car as { supplier_id?: string | null }).supplier_id || "",
            supplierTbd: !(car as { supplier_id?: string | null }).supplier_id,
            brand: car.brand || "",
            model: car.model || "",
            year: car.year ? String(car.year) : "",
            color: car.color || "",
            trim: "",
            options: "",
            saleDzd: car.sale_price_dzd != null ? String(car.sale_price_dzd) : "",
            depositDzd: car.sales_deposit_dzd != null ? String(car.sales_deposit_dzd) : "",
            leadTimeDays: car.sales_lead_time_days != null ? String(car.sales_lead_time_days) : "",
            sourceCost: String(cost.amount ?? 0),
            sourceCurrency: cost.currency === "AED" ? "AED" : "USD",
            sourceRateToDzd,
            sourceRateToAed: cost.currency === "AED" ? "1" : String(dzdPerAed),
            inventoryCarId: invId,
            salesCatalogEntryId: "",
            requireSupplierConfirmation: false,
          };
          if (cost.currency === "AED") {
            seed.sourceCurrency = "AED";
            seed.sourceRateToDzd = String(dzdPerAed);
            seed.sourceRateToAed = "1";
          }
          setPreorderFormSeed(seed);
          setPreorderLockedPricing(isStaff);
          setPreorderLockSourceCustom(true);
          setIsPreorderModalOpen(true);
          setError(null);
          return;
        }

        if (catId) {
          const res = await fetch(`/api/sales-list/catalog/${encodeURIComponent(catId)}`, { cache: "no-store" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(data.error || t("deals.catalogNotFound"));
            return;
          }
          const row = data.row as Record<string, unknown>;
          const est = Number(row.cost_estimate_dzd ?? 0);
          const seed: Partial<PreorderForm> = {
            source: "PRE_ORDER_CUSTOM",
            supplierId: String(row.supplier_id || ""),
            supplierTbd: !row.supplier_id,
            brand: String(row.brand || ""),
            model: String(row.model || ""),
            year: row.year != null ? String(row.year) : "",
            color: Array.isArray(row.color_options) && row.color_options.length ? String(row.color_options[0]) : "",
            trim: String(row.trim || ""),
            options: String(row.buyer_responsibilities_note || ""),
            saleDzd: String(row.sale_price_dzd ?? ""),
            depositDzd: String(row.deposit_amount_dzd ?? ""),
            leadTimeDays: String(row.lead_time_days ?? ""),
            sourceCost: String(est),
            sourceCurrency: "AED",
            sourceRateToDzd: String(dzdPerAed),
            sourceRateToAed: String(dzdPerAed),
            inventoryCarId: "",
            salesCatalogEntryId: catId,
            requireSupplierConfirmation: false,
          };
          setPreorderFormSeed(seed);
          setPreorderLockedPricing(isStaff);
          setPreorderLockSourceCustom(true);
          setIsPreorderModalOpen(true);
          setError(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("deals.preorderOpenFailed"));
      }
    })();
  }, [isLoading, cars, searchParams, router, rates, isStaff, t]);

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
  const dealRateDzdPerUsd = parseNum(form.rate);
  const sourceCost = selectedCar?.purchase_price ?? 0;
  const rawSourceCurrency = String(selectedCar?.purchase_currency ?? "").trim();
  const sourceCurrency = (rawSourceCurrency || "AED").toUpperCase();
  const usdPerAed = usdPerAedFromAppUsdSetting(rates.USD);
  const dealRateDzdPerAed =
    dealRateDzdPerUsd > 0
      ? dealRateDzdPerUsd * (usdPerAed > 0 ? usdPerAed : 1)
      : rates.DZD > 0
        ? rates.DZD
        : 0;

  const saleRateToAedSnapshot = saleDzdRateToAedFromDzdPerAed(dealRateDzdPerAed);
  const costF = carPurchaseToCostFact(selectedCar, rates);
  const fxToday = displayFxFromAppRates({ USD: rates.USD, DZD: rates.DZD, EUR: rates.EUR });
  const expenseFacts = formLinesToExpenseFacts(form, { usdExpenseRateToAed: fxToday.aedPerUsd });
  const dealCorePreview = computeDealCore({
    sale: { amount: saleDzd, currency: "DZD", rateToAed: saleRateToAedSnapshot },
    cost: { amount: costF.amount, currency: costF.currency, rateToAed: costF.rateToAed },
    expenses: expenseFacts,
  });

  const shippingAed = parseNum(form.shippingAed);
  const inspectionAed = parseNum(form.inspectionAed);
  const recoveryAed = parseNum(form.recoveryAed);
  const maintenanceAed = parseNum(form.maintenanceAed);
  const otherAed = parseNum(form.otherAed);

  const saleAed = dealCorePreview.saleAed;
  const carCostAed = dealCorePreview.costAed;
  const costPlusExpensesAed = dealCorePreview.costAed + dealCorePreview.expensesAedTotal;
  const profitPreviewAed = dealCorePreview.profitAed;
  const profitPreview = profitPreviewAed;
  const isAedSourcedCar = costF.currency === "AED" || sourceCurrency === "AED";
  const snapshotAedPerUsd =
    costF.currency === "USD" && costF.rateToAed > 0 ? costF.rateToAed : fxToday.aedPerUsd;
  const profitPreviewUsd =
    !isAedSourcedCar && snapshotAedPerUsd > 0 ? profitPreviewAed / snapshotAedPerUsd : 0;
  const profitPreviewDzd =
    dealRateDzdPerAed > 0
      ? profitPreviewAed * dealRateDzdPerAed
      : fxToday.aedPerDzd > 0
        ? profitPreviewAed / fxToday.aedPerDzd
        : 0;
  const derivedSaleUsd =
    dealRateDzdPerUsd > 0
      ? saleDzd / dealRateDzdPerUsd
      : snapshotAedPerUsd > 0
        ? saleAed / snapshotAedPerUsd
        : 0;
  const costPlusExpensesUsd = snapshotAedPerUsd > 0 ? costPlusExpensesAed / snapshotAedPerUsd : 0;
  const costPlusExpensesDzd =
    dealRateDzdPerAed > 0
      ? costPlusExpensesAed * dealRateDzdPerAed
      : fxToday.aedPerDzd > 0
        ? costPlusExpensesAed / fxToday.aedPerDzd
        : 0;
  const carCostUsd =
    isAedSourcedCar
      ? 0
      : sourceCurrency === "USD"
        ? sourceCost
        : usdPerAed > 0
          ? carCostAed * usdPerAed
          : aedToCurrency(dealCorePreview.costAed, "USD", fxToday);
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
    const exRows = dealExpensesByDealId[deal.id] ?? [];
    const exForm = expensesByTypeToFormFields(exRows);
    setForm({
      clientId: dealExt.client_id ?? "",
      date: (deal.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      carId: deal.car_id || "",
      employeeId: dealExt.handled_by ?? "",
      isManagedDeal: false,
      saleDzd: String(dealListSaleDzd(deal) || deal.sale_amount || ""),
      amountReceivedDzd:
        deal.collected_dzd != null ? String(deal.collected_dzd) : "0",
      rate: rateFieldFromDealWithDashboardFallback(deal, usdPerAed, appRatesSlice),
      shippingAed: exForm.shippingAed,
      shippingUsd: exForm.shippingUsd,
      inspectionAed: exForm.inspectionAed,
      recoveryAed: exForm.recoveryAed,
      maintenanceAed: exForm.maintenanceAed,
      otherAed: exForm.otherAed,
      shippingPaid: Boolean(deal.shipping_paid),
      notes: deal.notes || "",
      driveLink: (deal as Deal & { drive_link?: string | null }).drive_link ?? "",
      status: ((deal.status || "pending").toLowerCase() === "closed" ? "closed" : "pending"),
      saleUsd:
        deal.invoice_declared_usd != null ? String(deal.invoice_declared_usd) : "",
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
      setError(t("deals.quickClientRequired"));
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
    if (!form.clientId.trim()) return t("deals.valClientRequired");
    if (!clients.some((c) => c.id === form.clientId)) {
      return t("deals.valClientValid");
    }
    if (!form.date) return t("deals.valDateRequired");
    if (!form.carId) return t("deals.valCarRequired");
    if (!form.saleDzd.trim()) return t("deals.valSaleDzdRequired");
    if (!isStaff) {
      if (!form.rate.trim()) return t("deals.valRateRequired");
      if (dealRateDzdPerUsd <= 0) return t("deals.valRatePositive");
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
      setError(t("deals.collectedExceedsSale", { amount: fmtNum(saleDzd) }));
      return;
    }

    setIsSaving(true);
    setError(null);

    const saveFx = displayFxFromAppRates({ USD: rates.USD, DZD: rates.DZD, EUR: rates.EUR });

    const car = selectedCar;
    const costSnap = carPurchaseToCostFact(car, rates);
    const saleSnapshotRate = saleDzdRateToAedFromDzdPerAed(dealRateDzdPerAed);
    const payload = {
      client_id: form.clientId || null,
      client_name: selectedClient?.name ?? "",
      car_id: form.carId,
      car_label: car ? carLabel(car) : null,
      date: form.date,
      handled_by: form.employeeId || null,
      handled_by_name: form.employeeId ? (employees.find((e) => e.id === form.employeeId)?.name ?? "") : null,
      sale_amount: saleDzd,
      sale_currency: "DZD",
      sale_rate_to_aed: saleSnapshotRate,
      cost_amount: costSnap.amount,
      cost_currency: costSnap.currency,
      cost_rate_to_aed: costSnap.rateToAed,
      invoice_declared_usd: parseNum(form.saleUsd) > 0 ? parseNum(form.saleUsd) : null,
      shipping_paid: form.shippingPaid,
      collected_dzd: amountReceivedDzd,
      pending_dzd: pendingDzd,
      status: form.status,
      notes: form.notes || null,
      drive_link: form.driveLink.trim() || null,
      created_by: user?.id || null,
      pending_completion: isStaff ? true : false,
    };

    const syncDealExpensesLocal = async (dealId: string) => {
      const exTypes = ["shipping", "customs", "inspection", "recovery", "maintenance", "other"];
      await supabase.from("deal_expenses").delete().eq("deal_id", dealId).in("expense_type", exTypes);
      const exRows = formLinesToExpenseFacts(form, { usdExpenseRateToAed: saveFx.aedPerUsd }).map((e) => ({
        deal_id: dealId,
        expense_type: e.expenseType,
        amount: e.amount,
        currency: e.currency,
        rate_to_aed: e.rateToAed,
      }));
      if (exRows.length) {
        const { error: exErr } = await supabase.from("deal_expenses").insert(exRows);
        if (exErr) throw exErr;
      }
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
        ? (!staffRes || !staffRes.ok ? new Error((await staffRes?.json().catch(() => ({})))?.error || t("deals.failedUpdateDeal")) : null)
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
            t("deals.failedUpdateDealSave"),
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
      try {
        await syncDealExpensesLocal(editingDealId);
        const localRows = formLinesToExpenseFacts(form, { usdExpenseRateToAed: saveFx.aedPerUsd }).map((e) => ({
          deal_id: editingDealId,
          expense_type: e.expenseType,
          amount: e.amount,
          currency: e.currency,
          rate_to_aed: e.rateToAed,
        })) as DealExpenseRow[];
        setDealExpensesByDealId((p) => ({ ...p, [editingDealId]: localRows }));
      } catch (syncErr) {
        setError(syncErr instanceof Error ? syncErr.message : t("deals.dealSavedExpensesSyncFailed"));
        setIsSaving(false);
        return;
      }
      await logActivity({
        action: "updated",
        entity: "deal",
        entity_id: editingDealId,
        description: `Deal updated – ${existingDeal?.client_name ?? ""} – ${existingDeal?.car_label ?? ""}`.trim(),
        amount: saleAed,
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
              profit: profitPreviewAed,
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
                  rate_snapshot: dealRateDzdPerAed > 0 ? dealRateDzdPerAed : null,
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
                rate_snapshot: dealRateDzdPerAed > 0 ? dealRateDzdPerAed : null,
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
        ? (!insertedRes || !insertedRes.ok ? new Error(insertedPayload?.error || t("deals.failedCreateDeal")) : null)
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
            t("deals.failedAddDeal"),
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
      try {
        await syncDealExpensesLocal(dealId);
        const localRows = formLinesToExpenseFacts(form, { usdExpenseRateToAed: saveFx.aedPerUsd }).map((e) => ({
          deal_id: dealId,
          expense_type: e.expenseType,
          amount: e.amount,
          currency: e.currency,
          rate_to_aed: e.rateToAed,
        })) as DealExpenseRow[];
        setDealExpensesByDealId((p) => ({ ...p, [dealId]: localRows }));
      } catch (syncErr) {
        setError(syncErr instanceof Error ? syncErr.message : t("deals.dealCreatedExpensesSyncFailed"));
        setIsSaving(false);
        return;
      }
      await logActivity({
        action: "created",
        entity: "deal",
        entity_id: dealId,
        description: `Deal created – ${newDeal.client_name ?? ""} – ${newDeal.car_label ?? ""}`.trim(),
        amount: saleAed,
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
            saleDzd: dealListSaleDzd(newDeal) || newDeal.sale_amount,
            saleAed,
            saleUsd: newDeal.invoice_declared_usd,
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
            t("deals.dealSavedCarSoldFailed"),
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
                rate_snapshot: dealRateDzdPerAed > 0 ? dealRateDzdPerAed : null,
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
        const initRateToAed =
          saleRateToAedSnapshot != null && saleRateToAedSnapshot > 0 ? saleRateToAedSnapshot : 1;
        const initAedEq = toAed(amountReceivedDzd, "DZD", initRateToAed);
        const paymentInsert = await supabase
          .from("payments")
          .insert({
            deal_id: dealId,
            dzd: amountReceivedDzd,
            amount: amountReceivedDzd,
            currency: "DZD",
            rate_to_aed: initRateToAed,
            date: form.date,
            type: "deal_init",
            kind: "deal_init",
            rate: initRateToAed,
            aed_equivalent: initAedEq,
            notes: form.notes || null,
          })
          .select("*")
          .single();

        if (paymentInsert.error) {
          // eslint-disable-next-line no-console
          console.log("Supabase initial payment insert error:", paymentInsert.error);
        } else {
          const paymentId = (paymentInsert.data as DealPayment).id;

          const movementInsert = await supabase.from("movements").insert({
            date: form.date,
            type: "In",
            category: "Client Payment",
            description: form.notes || "Initial payment on deal creation",
            amount: amountReceivedDzd,
            currency: "DZD",
            rate: initRateToAed,
            aed_equivalent: initAedEq,
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
    if (!canDelete) return;
    if (!window.confirm(t("deals.deleteDealConfirm"))) return;
    setIsDeletingId(deal.id);
    setError(null);

    // Step 1: Fetch all movements linked to this deal
    const { data: linkedMovements, error: movementsErr } = await supabase
      .from("movements")
      .select("id, type, amount, currency, pocket")
      .eq("deal_id", deal.id);
    if (movementsErr) {
      setError([t("deals.failedFetchMovementsPrefix"), movementsErr.message].filter(Boolean).join(" "));
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
        setError([t("deals.failedFetchCashReversal"), posErr.message].filter(Boolean).join(" "));
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
        setError([t("deals.failedReverseMovement"), updateErr.message].filter(Boolean).join(" "));
        setIsDeletingId(null);
        return;
      }
    }

    // Step 3: Only after all reversals succeeded — delete movements, payments, then deal
    const { error: delMovErr } = await supabase.from("movements").delete().eq("deal_id", deal.id);
    if (delMovErr) {
      setError([t("deals.failedDeleteMovements"), delMovErr.message].filter(Boolean).join(" "));
      setIsDeletingId(null);
      return;
    }
    const { error: delPayErr } = await supabase.from("payments").delete().eq("deal_id", deal.id);
    if (delPayErr) {
      setError([t("deals.failedDeletePayments"), delPayErr.message].filter(Boolean).join(" "));
      setIsDeletingId(null);
      return;
    }

    const { error: deleteError } = await supabase.from("deals").delete().eq("id", deal.id);
    if (deleteError) {
      // eslint-disable-next-line no-console
      console.log("Supabase deal delete error:", deleteError);
      setError(
        [t("deals.failedDeleteDeal"), deleteError.message, deleteError.details, deleteError.hint]
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
      amount: toAed(deal.sale_amount, deal.sale_currency, deal.sale_rate_to_aed) || undefined,
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
          t("deals.paymentsTableMissing"),
          pError.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
      setPayments([]);
    } else {
      const paymentRows = (data as DealPayment[]) ?? [];
      setPayments(paymentRows);
      setSelectedReceiptPaymentId(paymentRows[0]?.id ?? "");
    }
    setGeneratedDocsLoading(true);
    try {
      const docsRes = await fetch(`/api/contracts/generated?deal_id=${encodeURIComponent(deal.id)}`, {
        cache: "no-store",
      });
      const docsJson = await docsRes.json().catch(() => ({ rows: [] }));
      if (docsRes.ok) {
        setGeneratedDocuments((docsJson.rows as GeneratedDocumentRow[] | undefined) ?? []);
      } else {
        setGeneratedDocuments([]);
      }
    } catch {
      setGeneratedDocuments([]);
    } finally {
      setGeneratedDocsLoading(false);
    }
    setPaymentsLoading(false);
  };

  const closeView = () => {
    setViewDeal(null);
    setPayments([]);
    setGeneratedDocuments([]);
    setSelectedReceiptPaymentId("");
    setPaymentsError(null);
    setNewPaymentAmount("");
    setNewPaymentNote("");
  };

  const refetchGeneratedDocuments = async (dealId: string) => {
    setGeneratedDocsLoading(true);
    try {
      const res = await fetch(`/api/contracts/generated?deal_id=${encodeURIComponent(dealId)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setGeneratedDocuments((json.rows as GeneratedDocumentRow[] | undefined) ?? []);
      }
    } finally {
      setGeneratedDocsLoading(false);
    }
  };

  const downloadBlobResponse = async (res: Response) => {
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const m = /filename="([^"]+)"/i.exec(cd);
    const fileName = m?.[1] || "document.docx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const validatePreGen = (mode: DocumentMode, values: ModalFormValues, meta: PrefillMeta) => {
    const parsed = buildValidationSchema(mode, meta).safeParse(values);
    if (parsed.success) {
      setPreGenErrors({});
      return true;
    }
    const errors = parsed.error.flatten().fieldErrors;
    setPreGenErrors(
      Object.fromEntries(
        Object.entries(errors)
          .filter(([, v]) => (v || []).length > 0)
          .map(([k, v]) => [k as keyof ModalFormValues, (v || [])[0] || "Invalid"])
      )
    );
    return false;
  };

  const openPreGenerationModal = async (mode: DocumentMode) => {
    if (!viewDeal) return;
    if (mode === "receipt" && !selectedReceiptPaymentId) return;
    setPaymentsError(null);
    setSuccessMessage(null);
    setPreGenLoading(true);
    try {
      const res = await fetch("/api/contracts/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          deal_id: viewDeal.id,
          payment_id: mode === "receipt" ? selectedReceiptPaymentId : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t("deals.failedPrefill"));
      setPreGenMode(mode);
      setPreGenValues({ ...DEFAULT_MODAL_VALUES, ...(json.values || {}) });
      setPreGenMeta(
        (json.meta as PrefillMeta | undefined) || { dealSource: String(viewDeal.source || "").toUpperCase() || null, hasCarId: Boolean(viewDeal.car_id) }
      );
      setPreGenErrors({});
      setShowPreGenModal(true);
    } catch (e) {
      setPaymentsError(e instanceof Error ? e.message : t("deals.failedOpenPreGen"));
    } finally {
      setPreGenLoading(false);
    }
  };

  const handleGenerateFromModal = async () => {
    if (!viewDeal) return;
    const ok = validatePreGen(preGenMode, preGenValues, preGenMeta);
    if (!ok) return;
    if (preGenMode === "agreement") setIsGeneratingAgreement(true);
    else setIsGeneratingReceipt(true);
    setPaymentsError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch("/api/contracts/prepare-and-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: preGenMode,
          deal_id: viewDeal.id,
          payment_id: preGenMode === "receipt" ? selectedReceiptPaymentId : undefined,
          values: preGenValues,
          meta: preGenMeta,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j?.field_errors) {
          const serverErrors = Object.fromEntries(
            Object.entries(j.field_errors as Record<string, string[]>)
              .filter(([, v]) => (v || []).length > 0)
              .map(([k, v]) => [k as keyof ModalFormValues, (v || [])[0]])
          );
          setPreGenErrors(serverErrors);
        }
        throw new Error(j?.error || t("deals.failedGenerateDoc"));
      }
      await downloadBlobResponse(res);
      await refetchGeneratedDocuments(viewDeal.id);
      await fetchAll();
      setShowPreGenModal(false);
      setSuccessMessage(preGenMode === "agreement" ? t("deals.successAgreement") : t("deals.successReceipt"));
    } catch (e) {
      setPaymentsError(e instanceof Error ? e.message : t("deals.failedGenerateDoc"));
    } finally {
      setIsGeneratingAgreement(false);
      setIsGeneratingReceipt(false);
    }
  };

  const handleDownloadGenerated = async (id: string) => {
    setDownloadingDocId(id);
    setPaymentsError(null);
    try {
      const res = await fetch("/api/contracts/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generated_document_id: id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.url) throw new Error(j?.error || t("deals.failedDownloadDoc"));
      window.open(j.url as string, "_blank", "noopener,noreferrer");
    } catch (e) {
      setPaymentsError(e instanceof Error ? e.message : t("deals.failedDownloadDocGeneric"));
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleAddPayment = async () => {
    if (!viewDeal) return;

    const amount = parseNum(newPaymentAmount);
    if (amount <= 0) {
      setPaymentsError(t("deals.paymentAmountPositive"));
      return;
    }
    const pendingDzd = viewDeal.pending_dzd ?? 0;
    if (amount > pendingDzd) {
      setPaymentsError(t("deals.paymentExceedsPending", { amount: fmtNum(pendingDzd) }));
      return;
    }

    const date = newPaymentDate || new Date().toISOString().slice(0, 10);

    setIsAddingPayment(true);
    setPaymentsError(null);

    const dealId = viewDeal.id;

    const payRateToAed =
      String(viewDeal.sale_currency || "").toUpperCase() === "DZD" &&
      viewDeal.sale_rate_to_aed != null &&
      viewDeal.sale_rate_to_aed > 0
        ? viewDeal.sale_rate_to_aed
        : fxList.aedPerDzd > 0
          ? fxList.aedPerDzd
          : 1;
    const aedEq = toAed(amount, "DZD", payRateToAed);

    const {
      data: insertedPayment,
      error: paymentError,
    } = await supabase
      .from("payments")
      .insert({
        deal_id: dealId,
        dzd: amount,
        amount,
        currency: "DZD",
        rate_to_aed: payRateToAed,
        date,
        type: "client_payment",
        kind: "client_payment",
        rate: payRateToAed,
        aed_equivalent: aedEq,
        notes: newPaymentNote || null,
      })
      .select("*")
      .single();

    if (paymentError) {
      // eslint-disable-next-line no-console
      console.log("Supabase add payment error:", paymentError);
      setPaymentsError(
        [
          t("deals.failedAddPayment"),
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
          t("deals.dealBalancesUpdateFailed"),
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
      rate: payRateToAed,
      aed_equivalent: aedEq,
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
          t("deals.paymentMovementFailed"),
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
        description: `Payment added – ${fmtNum(amount)} DZD – ${viewDeal.client_name ?? ""} – ${viewDeal.car_label ?? ""}`.trim(),
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
          t("deals.paymentSavedPocketFetchFailed"),
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
            t("deals.paymentSavedPocketUpdateFailed"),
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
    if (!canDelete) return;
    if (!viewDeal) return;
    const amount = paymentAmountDzd(payment);
    if (amount <= 0) return;
    if (!window.confirm(t("deals.removePaymentConfirm"))) return;
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
      setPaymentsError(t("deals.reversePaymentCashFailed"));
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
      setPaymentsError(data.error || t("deals.lifecycleUpdateFailed"));
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
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="xl">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("deals.title")}</h1>
            <p className="text-sm font-medium text-danger">{t("deals.headerSubtitle")}</p>
          </div>
          {isInvestorReadOnly ? (
            <p className="text-sm text-default-500">{t("deals.viewOnlyDeals")}</p>
          ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onPress={() => {
                setPreorderFormSeed(null);
                setPreorderLockedPricing(false);
                setPreorderLockSourceCustom(false);
                setIsPreorderModalOpen(true);
              }}
            >
              {t("deals.addPreorder")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onPress={() => {
                setDummyError(null);
                setIsDummyDocsOpen(true);
              }}
            >
              {t("deals.dummyDocs")}
            </Button>
            <Button type="button" variant="primary" size="sm" onPress={openAddModal}>
              {t("deals.addDeal")}
            </Button>
          </div>
          )}
        </header>

        <div className="flex flex-wrap gap-2">
          {(["All", "Pending", "Closed"] as FilterTab[]).map((tab) => (
            <Button
              key={tab}
              type="button"
              size="sm"
              variant={activeTab === tab ? "primary" : "outline"}
              onPress={() => setActiveTab(tab)}
            >
              {filterTabLabel(tab)}
            </Button>
          ))}
        </div>
        {(searchParams.get("clientId") || searchParams.get("clientName")) && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{t("deals.filteredByClient")}</span>
            <Button type="button" variant="outline" size="sm" onPress={() => router.replace("/deals")}>
              {t("deals.clearFilter")}
            </Button>
          </div>
        )}

        <div className="rounded-lg border border-app surface p-3">
          <div className="grid gap-3 md:grid-cols-12 md:items-center">
            <input
              type="text"
              value={customerSearchInput}
              onChange={(e) => setCustomerSearchInput(e.target.value)}
              placeholder={t("deals.searchPlaceholder")}
              className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app md:col-span-9"
            />
            <div className="text-xs font-semibold text-muted md:col-span-3 md:text-right">
              {t("deals.resultsWithCount", { count: filteredDeals.length })}
            </div>
          </div>
        </div>

        {!isStaff && pendingCompletionCount > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t("deals.pendingCompletionBanner", { count: pendingCompletionCount })}
          </div>
        )}

        {error ? (
          <Alert.Root status="danger">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}
        {successMessage ? (
          <Alert.Root status="success">
            <Alert.Content>
              <Alert.Description>{successMessage}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <div className="rounded-lg border border-app surface">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-default-500">
              <Spinner size="md" color="danger" />
              <span className="text-sm">{t("deals.loadingDeals")}</span>
            </div>
          ) : filteredDeals.length === 0 ? (
            <div className="p-4 text-sm text-muted">{t("deals.noDealsFound")}</div>
          ) : (
            <>
            <div className="responsive-table-wrap">
              <table className="min-w-[620px] w-full text-left text-xs">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">{t("deals.colClient")}</th>
                    <th className="px-4 py-3">{t("deals.colCar")}</th>
                    <th className="px-4 py-3">{t("deals.colVin")}</th>
                    <th className="px-4 py-3">{t("deals.colDate")}</th>
                    <th className="px-4 py-3">{t("deals.colSaleDzd")}</th>
                    {!isStaff && <th className="px-4 py-3 hidden sm:table-cell">{t("deals.colRateDzdUsd")}</th>}
                    {!isStaff && <th className="px-4 py-3">{t("deals.colSaleUsd")}</th>}
                    {!isStaff && <th className="px-4 py-3 hidden sm:table-cell">{t("deals.colTotalExpenses")}</th>}
                    {!isStaff && <th className="px-4 py-3">{t("deals.colProfit")}</th>}
                    {!isStaff && <th className="px-4 py-3 hidden md:table-cell">{t("deals.colSource")}</th>}
                    {!isStaff && <th className="px-4 py-3 hidden md:table-cell">{t("deals.colLifecycle")}</th>}
                    <th className="px-4 py-3">{t("deals.colStatus")}</th>
                    <th className="px-4 py-3 w-10">{t("deals.colDrive")}</th>
                    <th className="px-4 py-3">{t("deals.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDeals.map((d) => {
                    const status = (d.status || "pending").toLowerCase();
                    const derived = d.derived;
                    const total = derived.costAed + derived.expensesAedTotal;
                    const saleDzdVal = dealListSaleDzd(d) || d.sale_amount || 0;
                    const rateDzdPerUsdCell =
                      d.sale_rate_to_aed != null && d.sale_rate_to_aed > 0 && usdPerAed > 0
                        ? fmtNum(1 / (d.sale_rate_to_aed * usdPerAed))
                        : t("deals.rateCellDash");
                    return (
                      <tr key={d.id} className="border-b border-app last:border-b-0">
                        <td className="px-4 py-3 font-semibold text-app">
                          {d.client_name || t("deals.clientDash")}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {d.car_label || t("deals.clientDash")}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {(() => {
                            const dealCar = resolveDealLinkedCar(d, cars);
                            const fullVin = (dealCar?.vin || "").trim();
                            const shortVin = vinShortUi(fullVin);
                            if (!fullVin) return <span className="text-muted">{t("deals.vinPending")}</span>;
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
                                    setError(t("deals.failedCopyVin"));
                                  }
                                }}
                                className="rounded border border-app bg-white px-2 py-1 text-[11px] font-semibold text-app hover:bg-gray-50"
                              >
                                {copiedVinDealId === d.id ? t("deals.copied") : shortVin}
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-app">{fmtDate(d.date ?? d.created_at)}</td>
                        <td className="px-4 py-3 text-app">{fmtMoney(saleDzdVal, "DZD")}</td>
                        {!isStaff && (
                          <td className="px-4 py-3 text-app hidden sm:table-cell">
                            {rateDzdPerUsdCell}
                          </td>
                        )}
                        {!isStaff && <td className="px-4 py-3 text-app">{fmtMoney(derived.saleUsd, "USD")}</td>}
                        {!isStaff && <td className="px-4 py-3 text-app hidden sm:table-cell">{fmtMoney(total, "AED")}</td>}
                        {!isStaff && (
                          <td className="px-4 py-3 font-semibold text-[var(--color-accent)]">
                            {fmtMoney(derived.profitAed, "AED")}
                          </td>
                        )}
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
                            {status === "closed" ? t("deals.statusChipClosed") : t("deals.statusChipPending")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <DriveLinkIcon href={(d as Deal & { drive_link?: string | null }).drive_link ?? ""} title={t("deals.openDriveFolder")} />
                        </td>
                        <td className="px-4 py-3">
                          <RowActionsMenu label={t("deals.rowActionsDeal")}>
                            <button
                              type="button"
                              onClick={() => openEditModal(d)}
                              disabled={(isStaff && !isPrivilegedRole) || isInvestorReadOnly}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              {t("common.edit")}
                            </button>
                            {canDelete ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(d)}
                              disabled={isStaff || isDeletingId === d.id}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
                            >
                              {isDeletingId === d.id ? t("deals.deleting") : t("common.delete")}
                            </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openView(d)}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              {t("common.view")}
                            </button>
                            {(() => {
                              const invUsd =
                                d.invoice_declared_usd != null && d.invoice_declared_usd > 0
                                  ? d.invoice_declared_usd
                                  : 0;
                              const showDocs = invUsd > 0 || (d.derived?.saleUsd ?? 0) > 0;
                              if (!showDocs) return null;
                              const saleUsdPdf = invUsd > 0 ? invUsd : d.derived.saleUsd;
                              const dzdToAed =
                                String(d.sale_currency || "").toUpperCase() === "DZD" &&
                                d.sale_rate_to_aed != null &&
                                d.sale_rate_to_aed > 0
                                  ? d.sale_rate_to_aed
                                  : fxList.aedPerDzd;
                              const advanceUsd =
                                (d.collected_dzd ?? 0) > 0 && dzdToAed > 0 && fxList.aedPerUsd > 0
                                  ? Math.round(((d.collected_dzd ?? 0) * dzdToAed) / fxList.aedPerUsd)
                                  : 0;
                              const balanceUsd =
                                (d.pending_dzd ?? 0) > 0 && dzdToAed > 0 && fxList.aedPerUsd > 0
                                  ? Math.round(((d.pending_dzd ?? 0) * dzdToAed) / fxList.aedPerUsd)
                                  : 0;
                              const dealCar = resolveDealLinkedCar(d, cars);
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
                                      saleUsd: saleUsdPdf,
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
                                      totalAmountUsd: saleUsdPdf,
                                      advanceUsd,
                                      balanceUsd,
                                    }}
                                  />
                                </>
                              );
                            })()}
                          </RowActionsMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredDeals.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-app px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{t("inventory.rowsPerPage")}</span>
                  <select
                    value={dealsPageSize}
                    onChange={(e) => setDealsPageSize(Number(e.target.value))}
                    className="rounded-md border border-[#222222] bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <span>
                    {t("inventory.paginationOf", {
                      start: (dealsPage - 1) * dealsPageSize + 1,
                      end: Math.min(dealsPage * dealsPageSize, filteredDeals.length),
                      total: filteredDeals.length,
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                <span className="text-xs text-muted">{t("inventory.pageOf", { page: dealsPage, pages: dealsPages })}</span>
                <Button type="button" size="sm" variant="outline" isDisabled={dealsPage <= 1} onPress={() => setDealsPage((p) => Math.max(1, p - 1))}>
                  {t("inventory.pagerPrevious")}
                </Button>
                <Button type="button" size="sm" variant="outline" isDisabled={dealsPage >= dealsPages} onPress={() => setDealsPage((p) => Math.min(dealsPages, p + 1))}>
                  {t("inventory.pagerNext")}
                </Button>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </PageContainer>

      {/* Add/Edit Modal */}
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative flex w-full max-w-3xl max-h-screen flex-col overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  {editingDealId ? t("deals.editDeal") : t("deals.addDeal")}
                </div>
                <div className="text-xs text-muted">
                  {t("deals.modalSaleUsdProfitHint")}
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                {t("common.close")}
              </button>
            </div>

            <div className="mt-4 grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("deals.date")}</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("deals.client")}</span>
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
                    placeholder={t("deals.selectClientPlaceholder")}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                  {clientDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-app surface py-1 shadow-lg">
                      {filteredClientsForDropdown.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">{t("deals.noClientsMatch")}</div>
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
                        {t("deals.addNewClient")}
                      </button>
                    </div>
                  )}
                </div>
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("deals.car")}</span>
                <select
                  value={form.carId}
                  onChange={(e) => updateField("carId", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">{t("deals.selectCarAvailable")}</option>
                  {availableCars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {carLabel(c)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("deals.handledBy")}</span>
                <select
                  value={form.employeeId}
                  onChange={(e) => updateField("employeeId", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">{t("deals.noEmployee")}</option>
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
                    <span>{t("deals.managedDealCheckbox")}</span>
                  </label>
                )}
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("deals.colSaleDzd")}</span>
                <input
                  type="number"
                  value={form.saleDzd}
                  onChange={(e) => updateField("saleDzd", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("deals.amountReceived")} DZD</span>
                <input
                  type="number"
                  value={form.amountReceivedDzd}
                  onChange={(e) => updateField("amountReceivedDzd", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-app">{t("deals.pendingDzdLabel")}</span>
                  <span className="text-app">{fmtMoney(pendingDzd, "DZD")}</span>
                </div>
              </div>

              {!isStaff && (
                <>
                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">{t("deals.rateAtDeal")}</span>
                    <input
                      type="number"
                      value={form.rate}
                      onChange={(e) => updateField("rate", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                    <p className="text-[11px] leading-snug text-muted">
                      {t("deals.rateAtDealHelp")}
                    </p>
                    {editingDealId
                      ? (() => {
                          const ed = deals.find((x) => x.id === editingDealId);
                          return ed?.financial_migration_status === "needs_review" ? (
                            <p className="text-[11px] text-amber-800">
                              {t("deals.rateMigrationFlag")}
                            </p>
                          ) : null;
                        })()
                      : null}
                  </label>

                  {isAedSourcedCar && (
                    <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-semibold text-app">{t("deals.derivedSaleAed")}</span>
                        <span className="text-app">{fmtMoney(saleAed, "AED")}</span>
                      </div>
                    </div>
                  )}

                  {!isAedSourcedCar && (
                    <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-semibold text-app">{t("deals.saleUsdLabel")}</span>
                        <span className="text-app">{fmtMoney(derivedSaleUsd, "USD")}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-500">
                        <span>{t("deals.derivedSaleAedSmall")}</span>
                        <span>{fmtMoney(saleAed, "AED")}</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("deals.salePriceUsdInvoice")}{" "}<span className="text-[10px] font-normal text-zinc-400">{t("deals.salePriceUsdInvoiceSuffix")}</span></span>
                <input
                  type="number"
                  value={form.saleUsd}
                  onChange={(e) => updateField("saleUsd", e.target.value)}
                  placeholder={t("deals.ratePlaceholder")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              {!isStaff && (
                <>
                  <div className="sm:col-span-2">
                    <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      {t("deals.expenses")}
                    </div>
                  </div>

                  <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-app">{t("deals.carCostSource")}</span>
                      <span className="text-app">{fmtMoney(sourceCost, sourceCurrency)}</span>
                    </div>
                    {!isAedSourcedCar && (
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                        <span className="font-semibold text-app">{t("deals.carCostConvertedUsd")}</span>
                        <span className="text-app">{fmtMoney(carCostUsd, "USD")}</span>
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-gray-400">
                      {isAedSourcedCar
                        ? t("deals.carCostHintAedSourced")
                        : t("deals.carCostHintFromPurchase")}
                    </div>
                  </div>

                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">{t("deals.shippingAed")}</span>
                    <input
                      type="number"
                      value={form.shippingAed}
                      onChange={(e) => updateField("shippingAed", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">{t("deals.shippingUsd")}</span>
                    <span className="mb-0.5 block text-[10px] font-normal text-gray-400">
                      {t("deals.shippingUsdHint")}
                    </span>
                    <input
                      type="number"
                      value={form.shippingUsd}
                      onChange={(e) => updateField("shippingUsd", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">{t("deals.inspectionAedLabel")}</span>
                    <input
                      type="number"
                      value={form.inspectionAed}
                      onChange={(e) => updateField("inspectionAed", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">{t("deals.recoveryAedLabel")}</span>
                    <input
                      type="number"
                      value={form.recoveryAed}
                      onChange={(e) => updateField("recoveryAed", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">{t("deals.maintenanceAedLabel")}</span>
                    <input
                      type="number"
                      value={form.maintenanceAed}
                      onChange={(e) => updateField("maintenanceAed", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">{t("deals.otherAedLabel")}</span>
                    <input
                      type="number"
                      value={form.otherAed}
                      onChange={(e) => updateField("otherAed", e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                    <span className="font-semibold">{t("deals.shippingPaidLabel")}</span>
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
                      {form.shippingPaid ? t("common.yes") : t("common.no")}
                    </button>
                  </label>

                  <div className="rounded-md border border-app bg-white px-3 py-2 text-xs text-app sm:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-app">{t("deals.liveProfitPreview")}</span>
                      <span className="text-[var(--color-accent)]">
                        {isAedSourcedCar
                          ? fmtMoney(profitPreviewAed, "AED")
                          : fmtMoney(profitPreviewUsd, "USD")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-500">
                      <span>
                        {isAedSourcedCar
                          ? dealRateDzdPerAed > 0
                            ? t("deals.profitPreviewDzdDealRate")
                            : t("deals.profitPreviewDzdPlain")
                          : t("deals.profitPreviewDzdPlain")}
                      </span>
                      <span>{fmtMoney(profitPreviewDzd, "DZD")}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-500">
                      <span>{t("deals.profitPreviewAedLabel")}</span>
                      <span>{fmtMoney(profitPreviewAed, "AED")}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-400">
                      <span>{t("deals.costPlusExpAed")}</span>
                      <span>{fmtMoney(costPlusExpensesAed, "AED")}</span>
                    </div>
                    {!isAedSourcedCar && (
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-400">
                        <span>{t("deals.costPlusExpUsd")}</span>
                        <span>{fmtMoney(costPlusExpensesUsd, "USD")}</span>
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-400">
                      <span>{t("deals.costPlusExpDzd")}</span>
                      <span>{fmtMoney(costPlusExpensesDzd, "DZD")}</span>
                    </div>
                  </div>
                </>
              )}

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("deals.status")}</span>
                <select
                  value={form.status}
                  onChange={(e) => updateField("status", e.target.value as "pending" | "closed")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="pending">{t("status.pending")}</option>
                  <option value="closed">{t("status.closed")}</option>
                </select>
              </label>

              <div className="hidden sm:block" />

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("deals.driveFolderLink")}</span>
                <input
                  type="text"
                  value={form.driveLink}
                  onChange={(e) => updateField("driveLink", e.target.value)}
                  placeholder={t("deals.drivePlaceholder")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("deals.notes")}</span>
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
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSaving ? t("deals.savingModalEllipsis") : t("common.save")}
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
                <div className="text-lg font-semibold text-app">{t("deals.dealDetails")}</div>
                <div className="text-xs text-muted">
                  {viewDeal.client_name || "-"} • {viewDeal.car_label || "-"} •{" "}
                  {fmtDate(viewDeal.date ?? viewDeal.created_at)}
                </div>
                <div className="mt-2 space-y-2 text-xs text-app">
                  {(() => {
                    const dealCar = resolveDealLinkedCar(viewDeal, cars);
                    const fullVin = (dealCar?.vin || "").trim();
                    return (
                      <>
                        <div>
                          {!fullVin ? (
                            <span className="text-muted">{t("deals.vinPendingView")}</span>
                          ) : (
                            <button
                              type="button"
                              title={fullVin}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(fullVin);
                                  setCopiedVinDealId(viewDeal.id);
                                  setTimeout(
                                    () => setCopiedVinDealId((prev) => (prev === viewDeal.id ? null : prev)),
                                    1200
                                  );
                                } catch {
                                  setError(t("deals.failedCopyVin"));
                                }
                              }}
                              className="rounded border border-app bg-white px-2 py-1 text-[11px] font-semibold text-app hover:bg-gray-50"
                            >
                              {copiedVinDealId === viewDeal.id ? t("deals.copied") : vinShortUi(fullVin)}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-muted">{t("deals.physicalLifecycle")}</span>
                          {dealCar ? (
                            <Chip size="sm" variant="soft" className="h-6 px-2 text-[10px] uppercase">
                              {displayCarLifecycle(dealCar.lifecycle_status)}
                            </Chip>
                          ) : (
                            <span className="text-muted italic">{t("deals.noInventoryLinked")}</span>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <button
                type="button"
                onClick={closeView}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app"
              >
                {t("common.close")}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-app bg-white p-3 text-xs text-app">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-app">{t("deals.detailSale")}</span>
                  <span className="text-app">
                    {fmtMoney(
                      viewDeal.sale_amount,
                      (viewDeal.sale_currency || "AED") as "AED" | "USD" | "DZD" | "EUR"
                    )}
                  </span>
                </div>
                {!isStaff && (
                  <>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                      <span>{t("deals.rateDzdUsdShort")}</span>
                      <span>
                        {String(viewDeal.sale_currency || "").toUpperCase() === "DZD" &&
                        viewDeal.sale_rate_to_aed != null &&
                        viewDeal.sale_rate_to_aed > 0 &&
                        usdPerAed > 0
                          ? fmtNum(1 / (viewDeal.sale_rate_to_aed * usdPerAed))
                          : "-"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                      <span>{t("deals.saleUsdDisplayFx")}</span>
                      <span>{fmtMoney(viewDealDerived?.derived.saleUsd ?? 0, "USD")}</span>
                    </div>
                    {viewDeal.invoice_declared_usd != null && viewDeal.invoice_declared_usd > 0 ? (
                      <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                        <span>{t("deals.invoiceDeclaredUsd")}</span>
                        <span>{fmtMoney(viewDeal.invoice_declared_usd, "USD")}</span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {!isStaff ? (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-app">{t("deals.profit")}</span>
                    <span className="text-[var(--color-accent)]">
                      {fmtMoney(viewDealDerived?.derived.profitAed ?? 0, "AED")}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{t("deals.profitDzdDisplayFx")}</span>
                    <span className="text-app">
                      {fmtMoney(viewDealDerived?.derived.profitDzd ?? 0, "DZD")}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{t("deals.status")}</span>
                    <span className="text-app">{(viewDeal.status || "pending").toLowerCase() === "closed" ? t("status.closed") : t("status.pending")}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{t("deals.shippingPaidLabel")}</span>
                    <span className="text-app">{viewDeal.shipping_paid ? t("common.yes") : t("common.no")}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-app">{t("deals.status")}</span>
                    <span className="text-app">{(viewDeal.status || "pending").toLowerCase() === "closed" ? t("status.closed") : t("status.pending")}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{t("deals.shippingPaidLabel")}</span>
                    <span className="text-app">{viewDeal.shipping_paid ? t("common.yes") : t("common.no")}</span>
                  </div>
                </div>
              )}

              {!isStaff && (
              <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("deals.costExpenses")}
                </div>
                {(() => {
                  const dealCar = resolveDealLinkedCar(viewDeal, cars);
                  const srcCurrency = ((dealCar?.purchase_currency || "AED") as string).toUpperCase();
                  const srcAmount = Number(dealCar?.purchase_price || 0);
                  if (!dealCar || !srcAmount || srcCurrency === "AED") return null;
                  return (
                    <div className="mt-2 rounded border border-app bg-[#fafafa] px-2 py-1 text-[11px] text-app">
                      {t("deals.carSourceCostPrefix")} {fmtMoney(srcAmount, srcCurrency)}
                    </div>
                  );
                })()}
                <div className="mt-2 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between gap-2 text-app">
                    <span className="text-muted">{t("deals.carCostDeal")}</span>
                    <span>
                      {fmtMoney(
                        viewDeal.cost_amount,
                        (viewDeal.cost_currency || "AED") as "AED" | "USD" | "DZD" | "EUR"
                      )}
                      <span className="ml-2 text-muted">
                        (
                        {fmtMoney(
                          toAed(viewDeal.cost_amount, viewDeal.cost_currency, viewDeal.cost_rate_to_aed),
                          "AED"
                        )}
                        )
                      </span>
                    </span>
                  </div>
                  {(dealExpensesByDealId[viewDeal.id] ?? []).map((ex) => (
                    <div
                      key={ex.id ?? `${ex.expense_type}-${ex.amount}-${ex.currency}`}
                      className="flex items-center justify-between gap-2 border-t border-app/40 pt-1 text-app"
                    >
                      <span className="text-muted capitalize">
                        {(ex.expense_type || "").replace(/_/g, " ")}
                      </span>
                      <span>
                        {fmtMoney(
                          ex.amount,
                          (ex.currency || "AED") as "AED" | "USD" | "DZD" | "EUR"
                        )}
                        <span className="ml-2 text-muted">
                          (
                          {fmtMoney(toAed(ex.amount, ex.currency, ex.rate_to_aed), "AED")}
                          )
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              )}

              <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
                {!isStaff ? (
                  <div className="mb-3 rounded-md border border-app bg-[#fafafa] p-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("deals.contractDocuments")}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openPreGenerationModal("agreement")}
                        disabled={isGeneratingAgreement || preGenLoading}
                        className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)] disabled:opacity-50"
                      >
                        {isGeneratingAgreement ? t("deals.generatingEllipsis") : t("deals.generateContract")}
                      </button>
                      <select
                        value={selectedReceiptPaymentId}
                        onChange={(e) => setSelectedReceiptPaymentId(e.target.value)}
                        className="rounded-md border border-app bg-white px-2 py-1 text-[11px] text-app"
                        disabled={payments.length === 0}
                        title={payments.length === 0 ? t("deals.receiptBlockedNoPayment") : t("deals.receiptSelectPayment")}
                      >
                        {payments.length === 0 ? (
                          <option value="">{t("deals.noPayments")}</option>
                        ) : (
                          payments.map((p) => (
                            <option key={p.id} value={p.id}>
                              {fmtDate(p.date ?? p.created_at)} - {fmtMoney(paymentAmountDzd(p), "DZD")}
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => openPreGenerationModal("receipt")}
                        disabled={payments.length === 0 || !selectedReceiptPaymentId || isGeneratingReceipt || preGenLoading}
                        title={payments.length === 0 ? t("deals.receiptBlockedNoPayment") : ""}
                        className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)] disabled:opacity-50"
                      >
                        {isGeneratingReceipt ? t("deals.generatingEllipsis") : t("deals.generateReceipt")}
                      </button>
                    </div>

                    <div className="mt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("deals.generatedDocuments")}</div>
                      {generatedDocsLoading ? (
                        <div className="mt-1 text-[11px] text-muted">{t("deals.loadingGeneratedDocuments")}</div>
                      ) : generatedDocuments.length === 0 ? (
                        <div className="mt-1 text-[11px] text-muted">{t("deals.noGeneratedDocumentsYet")}</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {generatedDocuments.map((doc) => (
                            <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-app pb-2 text-[11px] last:border-b-0 last:pb-0">
                              <div className="text-app">
                                <span className="font-semibold">{doc.document_type}</span>{" "}
                                <span className="text-muted">- {fmtDate(doc.generated_at)}</span>{" "}
                                <span className="text-muted">{t("deals.docByAuthor", { name: doc.generated_by_name || t("deals.unknown") })}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDownloadGenerated(doc.id)}
                                disabled={downloadingDocId === doc.id}
                                className="rounded border border-app bg-white px-2 py-0.5 text-[10px] font-semibold text-app hover:border-[var(--color-accent)] disabled:opacity-50"
                              >
                                {downloadingDocId === doc.id ? t("deals.preparingEllipsis") : t("deals.downloadAgain")}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("deals.paymentHistory")}
                  </div>
                  {(viewDeal.pending_dzd ?? 0) <= 0 ? (
                    <span className="text-[11px] text-gray-400">
                      {t("deals.dealNoPendingPayments")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsPaymentFormOpen((prev) => !prev)}
                      className="rounded-md border border-app surface px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)]/70"
                    >
                      {isPaymentFormOpen ? t("common.cancel") : t("deals.addPayment")}
                    </button>
                  )}
                </div>
                <div className="mt-2 rounded-md border border-app bg-white p-2 text-[11px] text-app">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-app">{t("deals.collected")} DZD</span>
                      <span className="mt-0.5 text-sm text-app">
                        {fmtMoney(viewDeal.collected_dzd, "DZD")}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-semibold text-app">{t("deals.pendingDzdLabel")}</span>
                      <span className="mt-0.5 text-sm text-[var(--color-accent)]">
                        {fmtMoney(viewDeal.pending_dzd, "DZD")}
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
                        <span className="font-semibold text-app">{t("deals.amountDzdPayment")}</span>
                        <input
                          type="number"
                          value={newPaymentAmount}
                          onChange={(e) => setNewPaymentAmount(e.target.value)}
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                        />
                        {exceedsPending && (
                          <p className="mt-1 text-red-300">
                            {t("deals.paymentExceedsPending", { amount: fmtNum(pendingDzd) })}
                          </p>
                        )}
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-app">{t("deals.date")}</span>
                        <input
                          type="date"
                          value={newPaymentDate}
                          onChange={(e) => setNewPaymentDate(e.target.value)}
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                        />
                      </label>
                    </div>
                    <label className="space-y-1">
                      <span className="font-semibold text-app">{t("deals.notes")}</span>
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
                        {isAddingPayment ? t("deals.savingModalEllipsis") : t("deals.savePayment")}
                      </button>
                    </div>
                        </>
                      );
                    })()}
                  </div>
                )}
                {paymentsLoading ? (
                  <div className="mt-2 text-sm text-muted">{t("deals.loadingPayments")}</div>
                ) : paymentsError ? (
                  <div className="mt-2 text-xs text-red-300">{paymentsError}</div>
                ) : payments.length === 0 ? (
                  <div className="mt-2 text-sm text-muted">{t("deals.noPaymentsYet")}</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-app pb-2 text-[11px] last:border-b-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-app">{fmtDate(p.date ?? p.created_at)}</span>
                          <span className="text-app">
                            {fmtMoney(paymentAmountDzd(p), "DZD")}
                          </span>
                          {p.notes ? <span className="text-gray-400">{p.notes}</span> : null}
                        </div>
                        {canDelete ? (
                        <button
                          type="button"
                          onClick={() => handleDeletePayment(p)}
                          disabled={deletingPaymentId === p.id}
                          className="rounded border border-app bg-white px-2 py-0.5 text-[10px] font-semibold text-red-400 hover:border-red-700 disabled:opacity-50"
                        >
                          {deletingPaymentId === p.id ? t("deals.removingEllipsis") : t("common.delete")}
                        </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(viewDeal.source === "PRE_ORDER_CATALOG" || viewDeal.source === "PRE_ORDER_CUSTOM") && (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t("deals.preorderLifecycle")}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["ORDERED", "SHIPPED", "ARRIVED", "CLOSED", "CANCELLED"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handleLifecycleTransition(status)}
                        disabled={lifecycleSaving || isInvestorReadOnly}
                        className="rounded border border-app bg-white px-2 py-1 text-[10px] font-semibold text-app hover:border-[var(--color-accent)] disabled:opacity-50"
                      >
                        {dealLifecycleLabel(t, status)}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-muted">
                    {t("deals.lifecycleCurrent")} {dealLifecycleLabel(t, viewDeal.lifecycle_status || "PRE_ORDER")}
                  </div>
                </div>
              )}

              {(viewDeal as Deal & { drive_link?: string | null }).drive_link ? (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("deals.googleDrive")}
                  </div>
                  <div className="mt-2">
                    <DriveLinkIcon href={(viewDeal as Deal & { drive_link?: string | null }).drive_link ?? ""} title={t("deals.openDriveFolder")} />
                  </div>
                </div>
              ) : null}
              {viewDeal.notes ? (
                <div className="rounded-md border border-app bg-white p-3 text-xs text-app sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("deals.notes")}
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
            <h3 className="text-sm font-semibold text-app">{t("deals.quickAddClientTitle")}</h3>
            <p className="mt-1 text-xs text-muted">{t("deals.quickAddClientHint")}</p>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1 text-xs text-app">
                <span className="font-semibold">{t("clients.nameCol")}</span>
                <input
                  type="text"
                  value={quickAddName}
                  onChange={(e) => setQuickAddName(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="block space-y-1 text-xs text-app">
                <span className="font-semibold">{t("clients.phoneCol")}</span>
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
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleQuickAddClient}
                disabled={quickAddSaving}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {quickAddSaving ? t("deals.savingModalEllipsis") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <PreGenerationModal
        open={showPreGenModal}
        mode={preGenMode}
        meta={preGenMeta}
        values={preGenValues}
        errors={preGenErrors}
        isGenerating={isGeneratingAgreement || isGeneratingReceipt}
        canGenerate={buildValidationSchema(preGenMode, preGenMeta).safeParse(preGenValues).success}
        onClose={() => {
          if (isGeneratingAgreement || isGeneratingReceipt) return;
          setShowPreGenModal(false);
        }}
        onChange={(key, value) => {
          setPreGenValues((prev) => ({ ...prev, [key]: value }));
          setPreGenErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }}
        onGenerate={handleGenerateFromModal}
      />

      <PreorderDealModal
        open={isPreorderModalOpen}
        formSeed={preorderFormSeed}
        lockedListPricing={preorderLockedPricing}
        lockSourceToCustom={preorderLockSourceCustom}
        onClose={() => {
          setIsPreorderModalOpen(false);
          setPreorderFormSeed(null);
          setPreorderLockedPricing(false);
          setPreorderLockSourceCustom(false);
        }}
        onCreated={fetchAll}
      />

      {isDummyDocsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setIsDummyDocsOpen(false)} />
          <div className="relative flex w-full max-w-4xl max-h-screen flex-col overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">{t("deals.dummyModalTitle")}</div>
                <div className="text-xs text-muted">{t("deals.dummyModalSubtitle")}</div>
              </div>
              <button type="button" onClick={() => setIsDummyDocsOpen(false)} className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app">{t("common.close")}</button>
            </div>
            {dummyError ? <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{dummyError}</div> : null}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input placeholder={t("deals.dummyClientName")} value={dummyForm.clientName} onChange={(e) => setDummyForm((p) => ({ ...p, clientName: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyClientPhone")} value={dummyForm.clientPhone} onChange={(e) => setDummyForm((p) => ({ ...p, clientPhone: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyPassport")} value={dummyForm.clientPassport} onChange={(e) => setDummyForm((p) => ({ ...p, clientPassport: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyCarBrand")} value={dummyForm.carBrand} onChange={(e) => setDummyForm((p) => ({ ...p, carBrand: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyCarModel")} value={dummyForm.carModel} onChange={(e) => setDummyForm((p) => ({ ...p, carModel: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyYear")} value={dummyForm.carYear} onChange={(e) => setDummyForm((p) => ({ ...p, carYear: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyColor")} value={dummyForm.carColor} onChange={(e) => setDummyForm((p) => ({ ...p, carColor: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyVin")} value={dummyForm.carVin} onChange={(e) => setDummyForm((p) => ({ ...p, carVin: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyCountryOrigin")} value={dummyForm.countryOfOrigin} onChange={(e) => setDummyForm((p) => ({ ...p, countryOfOrigin: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <label className="space-y-1">
                <span className="text-[11px] text-muted">{t("deals.dummyInvoiceDate")}</span>
                <input type="date" value={dummyForm.invoiceDate} onChange={(e) => setDummyForm((p) => ({ ...p, invoiceDate: e.target.value }))} className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted">{t("deals.dummyAgreementDate")}</span>
                <input type="date" value={dummyForm.agreementDate} onChange={(e) => setDummyForm((p) => ({ ...p, agreementDate: e.target.value }))} className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              </label>
              <input placeholder={t("deals.dummyAmountUsd")} value={dummyForm.amountUsd} onChange={(e) => setDummyForm((p) => ({ ...p, amountUsd: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app" />
              <input placeholder={t("deals.dummyExportTo")} value={dummyForm.exportTo} onChange={(e) => setDummyForm((p) => ({ ...p, exportTo: e.target.value }))} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app sm:col-span-2" />
              <textarea placeholder={t("deals.dummyNotes")} value={dummyForm.notes} onChange={(e) => setDummyForm((p) => ({ ...p, notes: e.target.value }))} rows={2} className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app sm:col-span-2" />
            </div>
            <div className="mt-3 flex justify-end">
              {dummyForm.id ? (
                <button type="button" onClick={cancelEditDummyDoc} className="mr-2 rounded-md border border-app px-4 py-2 text-sm font-semibold text-app">
                  {t("deals.cancelEditDummy")}
                </button>
              ) : null}
              <button type="button" onClick={saveDummyDoc} disabled={dummySaving} className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {dummySaving ? t("deals.savingDummyEllipsis") : dummyForm.id ? t("deals.updateDummyDoc") : t("deals.saveDummyDoc")}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {dummyDocs.slice(0, 12).map((doc) => {
                const date = fmtDate(doc.created_at);
                const invoiceNumber = `DINV-${doc.id.slice(0, 8).toUpperCase()}`;
                const invoiceDate = fmtDate(doc.invoice_date || doc.created_at);
                const agreementDate = fmtDate(doc.agreement_date || doc.created_at);
                return (
                  <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-app bg-white px-3 py-2 text-xs text-app">
                    <div>
                      {doc.client_name} - {doc.car_brand} {doc.car_model} ({date})
                      <div className="text-[10px] text-muted">{t("deals.invoiceAgreementMeta", { invoiceDate, agreementDate })}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => startEditDummyDoc(doc)} className="rounded border border-app px-2 py-1 text-[11px] font-semibold text-app hover:bg-gray-50">
                        {t("common.edit")}
                      </button>
                      <button type="button" onClick={() => deleteDummyDoc(doc.id)} className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50">
                        {t("common.delete")}
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

