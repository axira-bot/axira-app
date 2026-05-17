"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Chip, Spinner } from "@heroui/react";
import type { Car } from "@/lib/types";
import {
  CAR_LIFECYCLE_STATUSES,
  isCarLifecycleStatus,
  lifecycleStatusChipTone,
  type CarLifecycleStatus,
} from "@/lib/cars/carLifecycleStatus";
import { CAR_LOCATION, CAR_LOCATIONS, isCarLocation, suggestedLocationForLifecycle, type CarLocation } from "@/lib/cars/carLocations";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/context/AuthContext";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { PageContainer } from "@/components/ui/page-container";
import { SalesNotesField, type SalesNotesSaveResult } from "@/components/cars/SalesNotesField";
import {
  formatDateForLocale,
  formatNumberForLocale,
  useI18n,
  type Locale,
  type TranslateFn,
} from "@/lib/context/I18nContext";
import {
  carLocationOptionLabel,
  inventoryLifecycleLabel,
  pocketDetailLabel,
} from "@/lib/i18n/enumLabels";

type PaidPocket =
  | "Dubai Cash"
  | "Dubai Bank"
  | "Algeria Cash"
  | "Algeria Bank"
  | "Qatar"
  | "EUR Cash";

type CarFormState = {
  brand: string;
  model: string;
  year: string;
  color: string;
  mileage: string;
  vin: string;
  purchasePrice: string;
  purchaseCurrency: "AED" | "DZD" | "USD" | "EUR";
  purchaseRate: string;
  /** Empty string = NULL in DB; otherwise one of `CAR_LOCATIONS`. */
  location: "" | CarLocation;
  owner: "Axira" | "Client";
  clientName: string;
  notes: string;
  status: "available" | "sold";
  amountPaidToSupplier: string;
  paidFromPocket: PaidPocket | "";
  countryOfOrigin: string;
  // Specs
  bodyType: string;
  driveType: string;
  doors: string;
  seats: string;
  grade: string;
  bodyIssues: string;
  transmission: string;
  fuelType: string;
  engine: string;
  condition: string;
  features: string;
  // Listing price (public site)
  salePriceDzd: string;
  // Stock & publishing
  stockType: "axira" | "supplier";
  supplierName: string;
  isPublished: boolean;
  statusOverride: string;
  /** Algeria sales list */
  salesLeadTimeDays: string;
  salesDepositDzd: string;
  salesInternalNote: string;
  salesCostEstimateDzd: string;
  salesNotes: string;
  salesNotesUpdatedAt: string | null;
  salesNotesUpdatedByName: string | null;
};

const BRANDS = [
  "Acura","Alfa Romeo","Aston Martin","Audi","Bentley","BMW","Bugatti","Buick","BYD",
  "Cadillac","Changan","Chery","Chevrolet","Chrysler","Citroën","Dacia","Dodge","Ferrari",
  "Fiat","Ford","Geely","Genesis","GMC","Haval","Honda","Hummer","Hyundai","Infiniti",
  "Isuzu","Jeep","Kia","Lamborghini","Land Rover","Lexus","Lincoln","Maserati","Mazda",
  "McLaren","Mercedes","MG","Mini","Mitsubishi","Nissan","Opel","Peugeot","Porsche",
  "Ram","Range Rover","Renault","Rivian","Rolls Royce","Seat","Skoda","Smart","Subaru",
  "Suzuki","Tesla","Toyota","Volkswagen","Volvo",
];

const YEARS = ["2020","2021","2022","2023","2024","2025","2026"];

const emptyForm = (): CarFormState => ({
  brand: "Toyota",
  model: "",
  year: "2025",
  color: "",
  mileage: "",
  vin: "",
  purchasePrice: "",
  purchaseCurrency: "AED",
  purchaseRate: "",
  location: "",
  owner: "Axira",
  clientName: "",
  notes: "",
  status: "available",
  amountPaidToSupplier: "",
  paidFromPocket: "",
  countryOfOrigin: "",
  bodyType: "",
  driveType: "",
  doors: "",
  seats: "",
  grade: "",
  bodyIssues: "",
  transmission: "",
  fuelType: "",
  engine: "",
  condition: "",
  features: "",
  salePriceDzd: "",
  stockType: "axira",
  supplierName: "",
  isPublished: false,
  statusOverride: "",
  salesLeadTimeDays: "",
  salesDepositDzd: "",
  salesInternalNote: "",
  salesCostEstimateDzd: "",
  salesNotes: "",
  salesNotesUpdatedAt: null,
  salesNotesUpdatedByName: null,
});

function formatMoneyLocale(locale: Locale, value: number | null | undefined, currency: string | null | undefined) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const c = currency || "";
  return `${formatNumberForLocale(locale, v, { maximumFractionDigits: 0 })}${c ? ` ${c}` : ""}`;
}

function getEffectiveStatus(car: Car): string {
  if (car.status_override) return car.status_override;
  if (car.display_status) return car.display_status;
  return car.status || "available";
}

type StockTypeTab = "axira" | "supplier";
type FilterTab = "All" | "Dubai" | "Algeria" | "In Transit" | "Sold";
type ConditionTab = "brand_new" | "used";

const CAR_AUDIT_PAGE = 20;

type CarAuditLogRowUi = {
  id: string;
  field_name: string;
  old_value: string | null;
  new_value: string;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
};

function normalizeCondition(condition: string | null | undefined): string {
  return (condition || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isBrandNewCondition(condition: string | null | undefined): boolean {
  const normalized = normalizeCondition(condition);
  return normalized === "brand new" || normalized === "new";
}

function DisplayStatusBadge({ status, t }: { status: string; t: TranslateFn }) {
  if (status === "sold") return (
    <span className="inline-flex rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
      {t("inventory.soldBadge")}
    </span>
  );
  if (status === "in_transit") return (
    <span className="inline-flex rounded-full border border-blue-400 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
      {t("inventory.inTransitForSale")}
    </span>
  );
  return (
    <span className="inline-flex rounded-full border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[11px] font-semibold text-white">
      {t("inventory.availableBadge")}
    </span>
  );
}

function PublishedBadge({ published, t }: { published: boolean | null | undefined; t: TranslateFn }) {
  if (published) return (
    <span className="inline-flex rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      {t("inventory.liveBadge")}
    </span>
  );
  return (
    <span className="inline-flex rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
      {t("inventory.draftBadge")}
    </span>
  );
}

function coerceInventoryLifecycle(s: string | null | undefined): CarLifecycleStatus {
  const v = String(s ?? "").trim();
  return isCarLifecycleStatus(v) ? v : "ORDERED";
}

const inputCls = "w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]";
const labelCls = "space-y-1 text-xs text-app";

export default function InventoryPage() {
  const { t, locale } = useI18n();
  const { canDelete, isInvestorReadOnly, isOwnerLike, isManager } = useAuth();
  const canEditSalesListMeta = isOwnerLike || isManager;
  const canEditLifecycle = canEditSalesListMeta;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [poDealEligibility, setPoDealEligibility] = useState<"in_transit_or_arrived" | "arrived_only">(
    "in_transit_or_arrived"
  );
  const [carIdsWithDeals, setCarIdsWithDeals] = useState<Set<string>>(new Set());
  const [stockTypeTab, setStockTypeTab] = useState<StockTypeTab>("axira");
  const [conditionTab, setConditionTab] = useState<ConditionTab>("brand_new");
  const [activeTab, setActiveTab] = useState<FilterTab>("All");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<"available_only" | "all">(
    "available_only"
  );
  const [carsPage, setCarsPage] = useState(1);
  const [carsPageSize, setCarsPageSize] = useState(10);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCarId, setEditingCarId] = useState<string | null>(null);
  const [form, setForm] = useState<CarFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isPublishingId, setIsPublishingId] = useState<string | null>(null);
  const [isMarkingSoldId, setIsMarkingSoldId] = useState<string | null>(null);
  const [isConvertingId, setIsConvertingId] = useState<string | null>(null);
  const [createDealSupplierHint, setCreateDealSupplierHint] = useState<string | null>(null);

  // Photo upload state
  const [carPhotos, setCarPhotos] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoFolder, setPhotoFolder] = useState<string>("");
  const [selectedInventoryLifecycleIds, setSelectedInventoryLifecycleIds] = useState<string[]>([]);
  const [bulkInventoryLifecycle, setBulkInventoryLifecycle] = useState<CarLifecycleStatus>("ORDERED");
  const [inventoryLifecycleSaving, setInventoryLifecycleSaving] = useState(false);
  const [lifecycleSuccess, setLifecycleSuccess] = useState<string | null>(null);
  const [pendingLocationSuggestion, setPendingLocationSuggestion] = useState<{
    newLifecycle: CarLifecycleStatus;
    suggested: CarLocation;
    carIds: string[];
    singleCarLabel: string | null;
    /** Cars that received the lifecycle update (for banner copy). */
    lifecycleTargetCount: number;
  } | null>(null);
  const [carHistoryOpen, setCarHistoryOpen] = useState(false);
  const [carHistoryRows, setCarHistoryRows] = useState<CarAuditLogRowUi[]>([]);
  const [carHistoryLoading, setCarHistoryLoading] = useState(false);
  const [carHistoryError, setCarHistoryError] = useState<string | null>(null);
  const [carHistoryHasMore, setCarHistoryHasMore] = useState(false);

  const showRate = form.purchaseCurrency === "DZD" || form.purchaseCurrency === "USD" || form.purchaseCurrency === "EUR";
  const showClientName = form.owner === "Client";
  const isSupplier = form.stockType === "supplier";
  const supplierPaidNumeric = form.amountPaidToSupplier.trim() ? Number(form.amountPaidToSupplier) : 0;
  const showPaidFromPocket =
    !isSupplier &&
    supplierPaidNumeric > 0 &&
    (form.purchaseCurrency === "AED" || form.purchaseCurrency === "DZD" || form.purchaseCurrency === "EUR");

  const AED_POCKETS: PaidPocket[] = ["Dubai Cash", "Dubai Bank", "Qatar"];
  const DZD_POCKETS: PaidPocket[] = ["Algeria Cash", "Algeria Bank"];
  const EUR_POCKETS: PaidPocket[] = ["EUR Cash"];

  const fetchCars = async () => {
    setIsLoading(true);
    setError(null);
    const [{ data, error: fetchError }, { data: dealsData, error: dealsError }, { data: poEligibilityData, error: poEligibilityErr }] = await Promise.all([
      supabase
        .from("cars")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("deals").select("car_id").not("car_id", "is", null),
      supabase.from("app_settings").select("value").eq("key", "po_deal_eligibility").maybeSingle(),
    ]);

    if (fetchError || dealsError) {
      setError(t("inventory.loadFailed"));
      setCars([]);
      setCarIdsWithDeals(new Set());
      setIsLoading(false);
      return;
    }
    setCars((data as Car[]) ?? []);
    if (!poEligibilityErr) {
      const value = ((poEligibilityData as { value?: string | null } | null)?.value || "").trim();
      if (value === "arrived_only" || value === "in_transit_or_arrived") setPoDealEligibility(value);
    }
    const dealCarIds = new Set(
      ((dealsData as { car_id?: string | null }[] | null) ?? [])
        .map((d) => d.car_id)
        .filter((id): id is string => Boolean(id))
    );
    setCarIdsWithDeals(dealCarIds);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!lifecycleSuccess) return;
    const t = window.setTimeout(() => setLifecycleSuccess(null), 5000);
    return () => window.clearTimeout(t);
  }, [lifecycleSuccess]);

  const toggleInventoryLifecycleSelection = (carId: string) => {
    setSelectedInventoryLifecycleIds((prev) =>
      prev.includes(carId) ? prev.filter((x) => x !== carId) : [...prev, carId]
    );
  };

  const dismissLocationSuggestion = () => setPendingLocationSuggestion(null);

  const applyLocationSuggestion = async () => {
    if (!pendingLocationSuggestion) return;
    const { suggested, carIds } = pendingLocationSuggestion;
    const { error: locErr } = await supabase.from("cars").update({ location: suggested }).in("id", carIds);
    if (locErr) {
      setError(locErr.message);
      return;
    }
    dismissLocationSuggestion();
    await fetchCars();
  };

  const updateInventoryLifecycle = async (carIds: string[], lifecycle_status: CarLifecycleStatus) => {
    if (!carIds.length || !canEditLifecycle) return;
    const unique = [...new Set(carIds)];
    setInventoryLifecycleSaving(true);
    setError(null);
    setLifecycleSuccess(null);
    setPendingLocationSuggestion(null);
    const res = await fetch("/api/cars/lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ car_ids: unique, lifecycle_status }),
    });
    const data = await res.json().catch(() => ({}));
    setInventoryLifecycleSaving(false);
    if (!res.ok) {
      setError((data.error as string) || t("inventory.lifecycleUpdateFailed"));
      return;
    }
    const n = typeof data.updated_count === "number" ? data.updated_count : unique.length;
    setLifecycleSuccess(n > 1 ? t("inventory.lifecycleSuccessMany", { count: n }) : t("inventory.lifecycleSuccessOne"));
    setSelectedInventoryLifecycleIds((prev) => prev.filter((id) => !unique.includes(id)));

    const suggested = suggestedLocationForLifecycle(lifecycle_status);
    if (suggested == null) {
      await fetchCars();
      return;
    }

    const { data: rows, error: rowErr } = await supabase
      .from("cars")
      .select("id, location, brand, model, year")
      .in("id", unique);
    if (rowErr || !rows?.length) {
      await fetchCars();
      return;
    }
    const needing = rows.filter((r) => String((r as { location?: string | null }).location ?? "").trim() !== suggested);
    if (needing.length > 0) {
      const single = unique.length === 1;
      const one = needing[0] as { brand?: string; model?: string; year?: number | null };
      const label = `${one.brand ?? ""} ${one.model ?? ""} ${one.year ?? ""}`.trim() || t("inventory.carTitleFallback");
      setPendingLocationSuggestion({
        newLifecycle: lifecycle_status,
        suggested,
        carIds: needing.map((r) => String((r as { id: string }).id)),
        singleCarLabel: single ? label : null,
        lifecycleTargetCount: unique.length,
      });
    }
    await fetchCars();
  };

  const resetCarAuditState = () => {
    setCarHistoryOpen(false);
    setCarHistoryRows([]);
    setCarHistoryError(null);
    setCarHistoryHasMore(false);
    setCarHistoryLoading(false);
  };

  const fetchCarAuditHistory = async ({ offset }: { offset: number }) => {
    if (!editingCarId || !canEditLifecycle) return;
    setCarHistoryLoading(true);
    setCarHistoryError(null);
    const res = await fetch(
      `/api/cars/${editingCarId}/audit-log?limit=${CAR_AUDIT_PAGE}&offset=${offset}`,
      { cache: "no-store" }
    );
    const data = await res.json().catch(() => ({}));
    setCarHistoryLoading(false);
    if (!res.ok) {
      setCarHistoryError((data.error as string) || t("inventory.historyLoadFailed"));
      return;
    }
    const raw = Array.isArray(data.rows) ? data.rows : [];
    const normalized: CarAuditLogRowUi[] = raw.map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ""),
      field_name: String(r.field_name ?? ""),
      old_value: r.old_value != null ? String(r.old_value) : null,
      new_value: String(r.new_value ?? ""),
      changed_by: r.changed_by != null ? String(r.changed_by) : null,
      changed_at: String(r.changed_at ?? ""),
      reason: r.reason != null ? String(r.reason) : null,
    }));
    setCarHistoryRows((prev) => (offset === 0 ? normalized : [...prev, ...normalized]));
    setCarHistoryHasMore(Boolean(data.has_more));
  };

  const toggleCarAuditSection = () => {
    const next = !carHistoryOpen;
    setCarHistoryOpen(next);
    setCarHistoryError(null);
    if (!next || !editingCarId || !canEditLifecycle) return;
    void fetchCarAuditHistory({ offset: 0 });
  };

  const isPoCarEligibleForDeal = (car: Car): boolean => {
    if (!car.purchase_order_id) return true;
    const lifecycle = (car.inventory_lifecycle_status || "").toUpperCase();
    const status = getEffectiveStatus(car).toLowerCase();
    if (poDealEligibility === "arrived_only") {
      return lifecycle === "ARRIVED" || lifecycle === "IN_STOCK" || lifecycle === "READY_TO_SHIP" || status === "available";
    }
    return (
      lifecycle === "IN_TRANSIT" ||
      lifecycle === "INCOMING" ||
      lifecycle === "ARRIVED" ||
      lifecycle === "READY_TO_SHIP" ||
      lifecycle === "IN_STOCK" ||
      status === "in_transit" ||
      status === "available"
    );
  };

  // Filter by stock type first, then by location/status tab
  const filteredCars = useMemo(() => {
    const byStock = cars.filter((c) => (c.stock_type || "axira") === stockTypeTab);
    const byCondition = byStock.filter((c) =>
      conditionTab === "brand_new" ? isBrandNewCondition(c.condition) : !isBrandNewCondition(c.condition)
    );
    const effectiveStatus = (c: Car) => getEffectiveStatus(c).toLowerCase();

    let base = byCondition;
    if (activeTab === "Sold") base = base.filter((c) => effectiveStatus(c) === "sold");
    else if (activeTab === "Dubai") base = base.filter((c) => c.location === CAR_LOCATION.dubaiShowroom);
    else if (activeTab === "Algeria") base = base.filter((c) => c.location === CAR_LOCATION.axiraDzShowroom);
    else if (activeTab === "In Transit")
      base = base.filter((c) => effectiveStatus(c) === "in_transit" || c.location === CAR_LOCATION.inTransit);

    if (availabilityFilter === "available_only") {
      base = base.filter((c) => effectiveStatus(c) !== "sold");
    }
    if (debouncedSearch) {
      base = base.filter((c) => {
        const vin = (c.vin || "").toLowerCase();
        const brand = (c.brand || "").toLowerCase();
        const model = (c.model || "").toLowerCase();
        const year = String(c.year || "").toLowerCase();
        const color = (c.color || "").toLowerCase();
        return (
          vin.includes(debouncedSearch) ||
          brand.includes(debouncedSearch) ||
          model.includes(debouncedSearch) ||
          year.includes(debouncedSearch) ||
          color.includes(debouncedSearch)
        );
      });
    }
    return base;
  }, [activeTab, availabilityFilter, conditionTab, stockTypeTab, cars, debouncedSearch]);

  const pagedCars = useMemo(() => {
    const start = (carsPage - 1) * carsPageSize;
    return filteredCars.slice(start, start + carsPageSize);
  }, [filteredCars, carsPage]);

  const carsPages = Math.max(1, Math.ceil(filteredCars.length / carsPageSize));

  useEffect(() => {
    if (carsPage > carsPages) setCarsPage(carsPages);
  }, [carsPage, carsPages]);

  useEffect(() => {
    setCarsPage(1);
  }, [activeTab, availabilityFilter, conditionTab, stockTypeTab, debouncedSearch, carsPageSize]);

  useEffect(() => {
    const valid = new Set(filteredCars.map((c) => c.id));
    setSelectedInventoryLifecycleIds((prev) => prev.filter((id) => valid.has(id)));
  }, [filteredCars]);

  const axiraCount = useMemo(() => cars.filter((c) => (c.stock_type || "axira") === "axira").length, [cars]);
  const supplierCount = useMemo(() => cars.filter((c) => c.stock_type === "supplier").length, [cars]);
  const stockCountsByCondition = useMemo(() => {
    const forStock = cars.filter((c) => (c.stock_type || "axira") === stockTypeTab);
    const brandNew = forStock.filter((c) => isBrandNewCondition(c.condition)).length;
    return {
      brandNew,
      used: Math.max(0, forStock.length - brandNew),
    };
  }, [cars, stockTypeTab]);

  const openAddModal = () => {
    resetCarAuditState();
    setEditingCarId(null);
    const base = emptyForm();
    base.stockType = stockTypeTab;
    base.condition = conditionTab === "brand_new" ? "Brand New" : "Used";
    setForm(base);
    setCarPhotos([]);
    setPhotoFolder(crypto.randomUUID());
    setIsModalOpen(true);
    setError(null);
  };

  const openEditModal = (car: Car) => {
    resetCarAuditState();
    setEditingCarId(car.id);
    setCarPhotos((car.photos as string[]) || []);
    setPhotoFolder(car.id);
    const purchasePrice = car.purchase_price ?? 0;
    const paid = car.supplier_paid ?? purchasePrice;
    const featuresArr = Array.isArray(car.features) ? car.features : [];
    setForm({
      brand: car.brand || "Toyota",
      model: car.model || "",
      year: car.year ? String(car.year) : "2025",
      color: car.color || "",
      mileage: car.mileage != null ? String(car.mileage) : "",
      vin: car.vin || "",
      purchasePrice: car.purchase_price != null ? String(car.purchase_price) : "",
      purchaseCurrency: (car.purchase_currency as "AED" | "DZD" | "USD" | "EUR") || "AED",
      purchaseRate: car.purchase_rate != null ? String(car.purchase_rate) : "",
      location: isCarLocation(car.location) ? car.location : "",
      owner: (car.owner as "Axira" | "Client") || "Axira",
      clientName: car.client_name || "",
      notes: car.notes || "",
      status: (car.status as "available" | "sold") || "available",
      amountPaidToSupplier: paid != null ? String(paid) : "",
      paidFromPocket: "",
      countryOfOrigin: car.country_of_origin || "",
      bodyType: car.body_type || "",
      driveType: car.drive_type || "",
      doors: car.doors != null ? String(car.doors) : "",
      seats: car.seats != null ? String(car.seats) : "",
      grade: car.grade || "",
      bodyIssues: car.body_issues || "",
      transmission: car.transmission || "",
      fuelType: car.fuel_type || "",
      engine: car.engine || "",
      condition: car.condition || "",
      features: featuresArr.join(", "),
      salePriceDzd: car.sale_price_dzd != null ? String(car.sale_price_dzd) : "",
      stockType: (car.stock_type as "axira" | "supplier") || "axira",
      supplierName: car.supplier_name || "",
      isPublished: car.is_published ?? false,
      statusOverride: car.status_override || "",
      salesLeadTimeDays: car.sales_lead_time_days != null ? String(car.sales_lead_time_days) : "",
      salesDepositDzd: car.sales_deposit_dzd != null ? String(car.sales_deposit_dzd) : "",
      salesInternalNote: car.sales_internal_note || "",
      salesCostEstimateDzd: car.sales_cost_estimate_dzd != null ? String(car.sales_cost_estimate_dzd) : "",
      salesNotes: car.sales_notes || "",
      salesNotesUpdatedAt: car.sales_notes_updated_at || null,
      salesNotesUpdatedByName: null,
    });
    setIsModalOpen(true);
    setError(null);
    void (async () => {
      const res = await fetch(`/api/sales-list/cars/${encodeURIComponent(car.id)}/detail`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setForm((prev) => ({
        ...prev,
        salesNotesUpdatedAt: (data.car?.sales_notes_updated_at as string | null | undefined) ?? prev.salesNotesUpdatedAt,
        salesNotesUpdatedByName: (data.sales_notes_updated_by_name as string | null | undefined) ?? null,
        salesNotes: String(data.car?.sales_notes ?? prev.salesNotes),
      }));
    })();
  };

  const closeModal = () => {
    if (isSaving) return;
    resetCarAuditState();
    setIsModalOpen(false);
  };

  const updateField = <K extends keyof CarFormState>(key: K, value: CarFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.color.trim()) return t("inventory.valColorRequired");
    if (!form.mileage.trim()) return t("inventory.valMileageRequired");
    const mileage = Number(form.mileage);
    if (Number.isNaN(mileage) || mileage < 0) return t("inventory.valMileageInvalid");
    if (showClientName && !form.clientName.trim()) return t("inventory.valClientNameRequired");
    if (showRate) {
      if (!form.purchaseRate.trim()) return t("inventory.valPurchaseRateRequired");
      const rate = Number(form.purchaseRate);
      if (Number.isNaN(rate) || rate <= 0) return t("inventory.valPurchaseRateInvalid");
    }
    if (form.purchasePrice.trim()) {
      const price = Number(form.purchasePrice);
      if (Number.isNaN(price) || price < 0) return t("inventory.valPurchasePriceInvalid");
    }
    if (showPaidFromPocket && !form.paidFromPocket) {
      return t("inventory.valPaidFromPocketRequired");
    }
    if (form.stockType === "supplier" && !form.supplierName.trim()) {
      return t("inventory.valSupplierNameRequired");
    }
    return null;
  };

  const handlePhotoUpload = async (files: FileList) => {
    if (isInvestorReadOnly) return;
    if (!files.length) return;
    setIsUploadingPhoto(true);
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${photoFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("car-photos")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("car-photos").getPublicUrl(path);
        newUrls.push(urlData.publicUrl);
      }
    }
    setCarPhotos((prev) => [...prev, ...newUrls]);
    setIsUploadingPhoto(false);
  };

  const handleDeletePhoto = async (url: string, index: number) => {
    if (!canDelete) return;
    const marker = "/car-photos/";
    const markerIdx = url.indexOf(marker);
    if (markerIdx !== -1) {
      const storagePath = url.slice(markerIdx + marker.length);
      await supabase.storage.from("car-photos").remove([storagePath]);
    }
    setCarPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (isInvestorReadOnly) return;
    const message = validate();
    if (message) {
      setError(message);
      return;
    }

    setIsSaving(true);
    setError(null);

    const purchasePriceNum = form.purchasePrice.trim() ? Number(form.purchasePrice) : 0;
    const supplierPaidNum = form.amountPaidToSupplier.trim() ? Number(form.amountPaidToSupplier) : purchasePriceNum;
    const supplierOwedNum = isSupplier ? 0 : Math.max(0, purchasePriceNum - supplierPaidNum);

    const featuresArr = form.features
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    const payload = {
      brand: form.brand,
      model: form.model || null,
      year: form.year ? Number(form.year) : null,
      color: form.color,
      mileage: Number(form.mileage),
      vin: form.vin || null,
      purchase_price: form.purchasePrice.trim() ? Number(form.purchasePrice) : null,
      purchase_currency: form.purchaseCurrency,
      purchase_rate: showRate ? Number(form.purchaseRate) : null,
      location: form.location.trim() ? form.location : null,
      owner: form.owner,
      client_name: showClientName ? form.clientName : null,
      status: form.status,
      notes: form.notes || null,
      supplier_paid: isSupplier ? null : supplierPaidNum,
      supplier_owed: isSupplier ? null : supplierOwedNum,
      country_of_origin: form.countryOfOrigin || null,
      photos: carPhotos.length > 0 ? carPhotos : null,
      // Specs
      body_type: form.bodyType || null,
      drive_type: form.driveType || null,
      doors: form.doors ? Number(form.doors) : null,
      seats: form.seats ? Number(form.seats) : null,
      grade: form.grade || null,
      body_issues: form.bodyIssues || null,
      transmission: form.transmission || null,
      fuel_type: form.fuelType || null,
      engine: form.engine || null,
      condition: form.condition || null,
      features: featuresArr.length > 0 ? featuresArr : null,
      // Listing price
      sale_price_dzd: form.salePriceDzd ? Number(form.salePriceDzd) : null,
      sales_lead_time_days: form.salesLeadTimeDays.trim() ? Number(form.salesLeadTimeDays) : null,
      sales_deposit_dzd: form.salesDepositDzd.trim() ? Number(form.salesDepositDzd) : null,
      sales_internal_note: form.salesInternalNote.trim() || null,
      sales_cost_estimate_dzd: form.salesCostEstimateDzd.trim() ? Number(form.salesCostEstimateDzd) : null,
      // Stock & publishing
      stock_type: form.stockType,
      supplier_name: form.stockType === "supplier" ? form.supplierName : null,
      is_published: form.isPublished,
      status_override: form.statusOverride || null,
    };

    const persistSalesNotes = async (carId: string): Promise<SalesNotesSaveResult | null> => {
      const res = await fetch(`/api/sales-list/cars/${encodeURIComponent(carId)}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sales_notes: form.salesNotes }),
      });
      const data = (await res.json().catch(() => ({}))) as SalesNotesSaveResult & { error?: string };
      if (!res.ok) {
        setError(data.error || t("inventory.failedSaveSalesNotes"));
        return null;
      }
      setForm((prev) => ({
        ...prev,
        salesNotesUpdatedAt: data.sales_notes_updated_at ?? null,
        salesNotesUpdatedByName: data.sales_notes_updated_by_name ?? null,
        salesNotes: data.sales_notes ?? prev.salesNotes,
      }));
      return data;
    };

    const carLabel = `${form.brand} ${form.model} ${form.year}`.trim();
    if (editingCarId) {
      const { error: updateError } = await supabase.from("cars").update(payload).eq("id", editingCarId);
      if (updateError) {
        setError([t("inventory.failedUpdateCar"), updateError.message, updateError.details, updateError.hint].filter(Boolean).join(" "));
        setIsSaving(false);
        return;
      }
      await logActivity({
        action: "updated",
        entity: "car",
        entity_id: editingCarId,
        description: `Car updated – ${carLabel}`,
        amount: payload.purchase_price ?? undefined,
        currency: payload.purchase_currency ?? undefined,
      });
    } else {
      const insertPayload = {
        ...payload,
        sales_notes: form.salesNotes.trim() ? form.salesNotes : null,
      };
      const { data: inserted, error: insertError } = await supabase
        .from("cars")
        .insert(insertPayload)
        .select("id")
        .single();
      if (insertError) {
        setError([t("inventory.failedAddCar"), insertError.message, insertError.details, insertError.hint].filter(Boolean).join(" "));
        setIsSaving(false);
        return;
      }
      const newCarId = (inserted as { id: string } | null)?.id;
      if (newCarId) {
        await logActivity({
          action: "created",
          entity: "car",
          entity_id: newCarId,
          description: `${form.stockType === "supplier" ? "Supplier listing" : "Car"} added – ${carLabel}`,
          amount: payload.purchase_price ?? undefined,
          currency: payload.purchase_currency ?? undefined,
        });
        // Telegram notification for AXIRA stock only
        if (form.stockType === "axira") {
          fetch("/api/telegram/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "new_car",
              data: { brand: payload.brand ?? "", model: payload.model ?? "", year: payload.year, color: payload.color },
            }),
          }).catch(() => {});
        }
      }

      // Financial movement only for AXIRA stock (not supplier listings)
      if (
        !isSupplier &&
        supplierPaidNum > 0 &&
        (form.purchaseCurrency === "AED" || form.purchaseCurrency === "DZD" || form.purchaseCurrency === "EUR") &&
        form.paidFromPocket
      ) {
        const today = new Date().toISOString().slice(0, 10);
        const description = `Purchased ${form.brand} ${form.model} ${form.year}`;
        const movementPayload = {
          date: today,
          type: "Out",
          category: "Car Purchase",
          description,
          amount: supplierPaidNum,
          currency: form.purchaseCurrency,
          rate: form.purchaseCurrency === "AED" || form.purchaseCurrency === "EUR" ? 1 : null,
          aed_equivalent: form.purchaseCurrency === "AED" || form.purchaseCurrency === "EUR" ? supplierPaidNum : null,
          pocket: form.paidFromPocket,
          deal_id: null,
          payment_id: null,
          reference: null,
        };

        const { error: movementError } = await supabase.from("movements").insert(movementPayload);
        if (movementError) {
          setError([t("inventory.carSavedMovementFailed"), movementError.message].filter(Boolean).join(" "));
        }

        const { data: pocketRow, error: pocketError } = await supabase
          .from("cash_positions")
          .select("id, amount")
          .eq("pocket", form.paidFromPocket)
          .eq("currency", form.purchaseCurrency)
          .maybeSingle();

        if (!pocketError && pocketRow) {
          const currentAmount = (pocketRow as { amount?: number }).amount || 0;
          await supabase
            .from("cash_positions")
            .update({ amount: currentAmount - supplierPaidNum })
            .eq("id", (pocketRow as { id: string }).id);
        }
      }

      if (newCarId && form.salesNotes.trim() && canEditSalesListMeta) {
        const sn = await persistSalesNotes(newCarId);
        if (sn === null) {
          setIsSaving(false);
          return;
        }
      }
    }

    await fetchCars();
    setIsSaving(false);
    setIsModalOpen(false);
  };

  const handleDelete = async (car: Car) => {
    if (!canDelete) return;
    const name = `${car.brand || ""} ${car.model || ""}`.trim() || t("inventory.carFallback");
    if (!window.confirm(t("inventory.deleteConfirm", { name }))) return;

    setIsDeletingId(car.id);
    setError(null);

    const { data: dealRows } = await supabase.from("deals").select("id").eq("car_id", car.id).limit(1);
    if (dealRows && dealRows.length > 0) {
      setError(t("inventory.deleteWithDeal"));
      setIsDeletingId(null);
      return;
    }

    const { data: containerCarRows } = await supabase.from("container_cars").select("id").eq("car_id", car.id).limit(1);
    if (containerCarRows && containerCarRows.length > 0) {
      setError(t("inventory.deleteInContainer"));
      setIsDeletingId(null);
      return;
    }

    // Reverse financial movement only for AXIRA stock
    if (car.stock_type !== "supplier") {
      const desc = `Purchased ${car.brand || ""} ${car.model || ""} ${car.year || ""}`.trim();
      const { data: purchaseMovements } = await supabase
        .from("movements")
        .select("id, type, amount, currency, pocket")
        .eq("category", "Car Purchase")
        .ilike("description", desc)
        .limit(1);
      const movement = purchaseMovements?.[0];
      if (movement) {
        const pocket = (movement as { pocket?: string }).pocket ?? "";
        const currency = ((movement as { currency?: string }).currency || "AED").trim() || "AED";
        const amount = (movement as { amount?: number }).amount ?? 0;
        if (pocket && amount > 0) {
          const { data: pos } = await supabase
            .from("cash_positions")
            .select("id, amount")
            .eq("pocket", pocket)
            .eq("currency", currency)
            .maybeSingle();
          if (pos && (pos as { id?: string }).id) {
            const current = (pos as { amount?: number }).amount ?? 0;
            await supabase.from("cash_positions").update({ amount: current + amount }).eq("id", (pos as { id: string }).id);
          }
          await supabase.from("movements").delete().eq("id", (movement as { id: string }).id);
        }
      }
    }

    const { error: deleteError } = await supabase.from("cars").delete().eq("id", car.id);
    if (deleteError) {
      setError(t("inventory.deleteFailed"));
      setIsDeletingId(null);
      return;
    }
    await logActivity({
      action: "deleted",
      entity: "car",
      entity_id: car.id,
      description: `Car deleted – ${car.brand ?? ""} ${car.model ?? ""} ${car.year ?? ""}`.trim(),
    });
    setCars((prev) => prev.filter((c) => c.id !== car.id));
    setIsDeletingId(null);
  };

  const handlePublishToggle = async (car: Car) => {
    if (isInvestorReadOnly) return;
    setIsPublishingId(car.id);
    const newValue = !car.is_published;
    const { error: err } = await supabase.from("cars").update({ is_published: newValue }).eq("id", car.id);
    if (!err) {
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, is_published: newValue } : c));
    }
    setIsPublishingId(null);
  };

  const handleMarkSold = async (car: Car) => {
    if (isInvestorReadOnly) return;
    const isAlreadySold = getEffectiveStatus(car) === "sold";
    if (isAlreadySold) {
      // Block restore if there is an active deal — must delete the deal first
      const { data: activeDeal } = await supabase
        .from("deals")
        .select("id, client_name")
        .eq("car_id", car.id)
        .limit(1)
        .maybeSingle();
      if (activeDeal) {
        setError(
          t("inventory.restoreBlockedDeal", {
            car: `${car.brand} ${car.model}`,
            withClient: activeDeal.client_name
              ? t("inventory.restoreBlockedWithClient", { name: String(activeDeal.client_name) })
              : "",
          })
        );
        return;
      }
      if (!window.confirm(t("inventory.confirmAvailableAgain"))) return;
      setIsMarkingSoldId(car.id);
      await supabase.from("cars").update({ display_status: "available", sold_at: null, status: "available", status_override: null }).eq("id", car.id);
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, display_status: "available", sold_at: null, status: "available", status_override: null } : c));
    } else {
      if (!window.confirm(t("inventory.confirmMarkSoldShort"))) return;
      setIsMarkingSoldId(car.id);
      const now = new Date().toISOString();
      await supabase.from("cars").update({ display_status: "sold", sold_at: now, status: "sold" }).eq("id", car.id);
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, display_status: "sold", sold_at: now, status: "sold" } : c));
    }
    setIsMarkingSoldId(null);
  };

  const handleConvertToAxira = async (car: Car) => {
    if (isInvestorReadOnly) return;
    if (
      !window.confirm(
        t("inventory.confirmConvert", {
          title: `${car.brand} ${car.model} ${car.year}`,
        })
      )
    )
      return;
    setIsConvertingId(car.id);
    const { error: err } = await supabase.from("cars").update({ stock_type: "axira", supplier_name: null }).eq("id", car.id);
    if (!err) {
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, stock_type: "axira", supplier_name: null } : c));
    }
    setIsConvertingId(null);
  };

  const filterTabLabels: Record<FilterTab, string> = useMemo(
    () => ({
      All: t("inventory.filterAll"),
      Dubai: t("inventory.filterDubai"),
      Algeria: t("inventory.filterAlgeria"),
      "In Transit": t("inventory.filterInTransit"),
      Sold: t("inventory.filterSold"),
    }),
    [t]
  );

  const sectionHeader = (title: string, sub?: string) => (
    <div className="sm:col-span-2 mt-2 border-b border-app pb-1">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">{title}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );

  return (
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="xl">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("inventory.title")}</h1>
            <p className="text-sm font-medium text-danger">{t("inventory.vehicleManagement")}</p>
            {isInvestorReadOnly ? (
              <p className="text-sm text-default-500">{t("inventory.viewOnlyAccess")}</p>
            ) : null}
          </div>
          {!isInvestorReadOnly ? (
          <Button type="button" variant="primary" size="sm" onPress={openAddModal}>
            {t("inventory.addPrefix", {
              label: stockTypeTab === "supplier" ? t("inventory.addSupplierListing") : t("inventory.addCar"),
            })}
          </Button>
          ) : null}
        </header>

        {/* Stock type tabs */}
        <div className="flex gap-0 rounded-lg border border-app overflow-hidden surface w-fit">
          <button
            type="button"
            onClick={() => { setStockTypeTab("axira"); setActiveTab("All"); }}
            className={[
              "px-4 py-2 text-xs font-semibold transition",
              stockTypeTab === "axira"
                ? "bg-[var(--color-accent)] text-white"
                : "text-muted hover:text-app",
            ].join(" ")}
          >
            {t("inventory.axiraStock", { count: axiraCount })}
          </button>
          <button
            type="button"
            onClick={() => { setStockTypeTab("supplier"); setActiveTab("All"); }}
            className={[
              "px-4 py-2 text-xs font-semibold transition border-l border-app",
              stockTypeTab === "supplier"
                ? "bg-amber-600 text-white"
                : "text-muted hover:text-app",
            ].join(" ")}
          >
            {t("inventory.supplierListings", { count: supplierCount })}
          </button>
        </div>

        {/* Condition tabs (user-defined only) */}
        <div className="flex gap-0 rounded-lg border border-app overflow-hidden surface w-fit">
          <button
            type="button"
            onClick={() => setConditionTab("brand_new")}
            className={[
              "px-4 py-2 text-xs font-semibold transition",
              conditionTab === "brand_new"
                ? "bg-[var(--color-accent)] text-white"
                : "text-muted hover:text-app",
            ].join(" ")}
          >
            {t("inventory.brandNew", { count: stockCountsByCondition.brandNew })}
          </button>
          <button
            type="button"
            onClick={() => setConditionTab("used")}
            className={[
              "px-4 py-2 text-xs font-semibold transition border-l border-app",
              conditionTab === "used"
                ? "bg-gray-700 text-white"
                : "text-muted hover:text-app",
            ].join(" ")}
          >
            {t("inventory.used", { count: stockCountsByCondition.used })}
          </button>
        </div>

        {stockTypeTab === "supplier" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠️ {t("inventory.supplierWarningHtml")}
          </div>
        )}

        {/* Location / status filter tabs */}
        <div className="flex flex-wrap gap-2">
          {(["All", "Dubai", "Algeria", "In Transit", "Sold"] as FilterTab[]).map((tab) => (
            <Button
              key={tab}
              type="button"
              size="sm"
              variant={activeTab === tab ? "primary" : "outline"}
              onPress={() => setActiveTab(tab)}
            >
              {filterTabLabels[tab]}
            </Button>
          ))}
        </div>

        <div className="rounded-lg border border-app surface p-3">
          <div className="grid gap-3 md:grid-cols-12 md:items-center">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("inventory.searchPlaceholder")}
              className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app md:col-span-8"
            />
            <select
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value as "available_only" | "all")}
              className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app md:col-span-2"
            >
              <option value="available_only">{t("inventory.availableOnly")}</option>
              <option value="all">{t("inventory.allIncludingSold")}</option>
            </select>
            <div className="text-xs font-semibold text-muted md:col-span-2 md:text-right">
              {t("inventory.resultsWithCount", { count: filteredCars.length })}
            </div>
          </div>
        </div>

        {createDealSupplierHint && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {createDealSupplierHint}
          </div>
        )}

        {lifecycleSuccess ? (
          <Alert.Root status="success">
            <Alert.Content>
              <Alert.Description>{lifecycleSuccess}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        {pendingLocationSuggestion ? (
          <Alert.Root status="warning">
            <Alert.Content>
              <Alert.Description>
                <div className="space-y-2 text-xs">
                  <p>
                    {pendingLocationSuggestion.singleCarLabel
                      ? t("inventory.lifecycleSuggestionOne", {
                          lifecycle: inventoryLifecycleLabel(t, pendingLocationSuggestion.newLifecycle),
                          label: pendingLocationSuggestion.singleCarLabel,
                          suggested: carLocationOptionLabel(t, pendingLocationSuggestion.suggested),
                        })
                      : t("inventory.lifecycleSuggestionMany", {
                          lifecycle: inventoryLifecycleLabel(t, pendingLocationSuggestion.newLifecycle),
                          count: pendingLocationSuggestion.lifecycleTargetCount,
                          suggested: carLocationOptionLabel(t, pendingLocationSuggestion.suggested),
                        })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="primary" onPress={() => void applyLocationSuggestion()}>
                      {pendingLocationSuggestion.singleCarLabel ? t("inventory.apply") : t("inventory.applyToAll")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onPress={dismissLocationSuggestion}>
                      {t("inventory.keepCurrentLocation")}
                    </Button>
                  </div>
                </div>
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        {canEditLifecycle && !isInvestorReadOnly && filteredCars.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-app/70 bg-black/[0.02] px-3 py-2 text-xs">
            <span className="font-semibold">{t("inventory.bulkSelected", { count: selectedInventoryLifecycleIds.length })}</span>
            <label className="flex flex-wrap items-center gap-1">
              <span className="text-muted">{t("inventory.bulkStatusLabel")}</span>
              <select
                className="rounded-md border border-app bg-white px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
                disabled={inventoryLifecycleSaving}
                value={bulkInventoryLifecycle}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isCarLifecycleStatus(v)) setBulkInventoryLifecycle(v);
                }}
              >
                {CAR_LIFECYCLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {inventoryLifecycleLabel(t, s)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="h-8 min-h-8 text-[11px]"
              isDisabled={inventoryLifecycleSaving || selectedInventoryLifecycleIds.length === 0}
              onPress={() => updateInventoryLifecycle(selectedInventoryLifecycleIds, bulkInventoryLifecycle)}
            >
              {t("inventory.updateStatusSelected")}
            </Button>
          </div>
        ) : null}

        {error ? (
          <Alert.Root status="danger">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <div className="rounded-lg border border-app surface">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-default-500">
              <Spinner size="md" color="danger" />
              <span className="text-sm">{t("inventory.loadingCars")}</span>
            </div>
          ) : filteredCars.length === 0 ? (
            <div className="p-4 text-sm text-muted">{t("inventory.noCarsFound")}</div>
          ) : (
            <>
            <div className="responsive-table-wrap">
              <table className="min-w-[780px] w-full text-left text-xs rtl:text-right">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    {canEditLifecycle && !isInvestorReadOnly ? (
                      <th className="w-10 px-2 py-3 text-center" aria-label={t("inventory.selectBulkAria")} />
                    ) : null}
                    <th className="px-4 py-3">{t("inventory.colCar")}</th>
                    <th className="px-4 py-3 hidden sm:table-cell">{t("inventory.colSpecs")}</th>
                    <th className="px-4 py-3 hidden sm:table-cell">{t("inventory.colLocation")}</th>
                    <th className="px-4 py-3">{t("inventory.colPhysicalLifecycle")}</th>
                    <th className="px-4 py-3">{t("inventory.colPrice")}</th>
                    <th className="px-4 py-3">{t("inventory.colSalesStatus")}</th>
                    <th className="px-4 py-3">{t("inventory.colPublished")}</th>
                    <th className="px-4 py-3">{t("inventory.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCars.map((car) => {
                    const carTitle = `${car.brand || ""} ${car.model || ""} ${car.year || ""}`.trim();
                    const effectiveStatus = getEffectiveStatus(car).toLowerCase();
                    const isSupplierCar = car.stock_type === "supplier";
                    const hasDealAlready = carIdsWithDeals.has(car.id);
                    return (
                      <tr key={car.id} className={["border-b border-app last:border-b-0", isSupplierCar ? "bg-amber-50/30" : ""].join(" ")}>
                        {canEditLifecycle && !isInvestorReadOnly ? (
                          <td className="w-10 px-2 py-3 align-middle text-center">
                            <input
                              type="checkbox"
                              className="align-middle"
                              aria-label={t("inventory.selectBulkAriaWithCar", { title: carTitle || t("inventory.carFallback") })}
                              checked={selectedInventoryLifecycleIds.includes(car.id)}
                              disabled={inventoryLifecycleSaving}
                              onChange={() => toggleInventoryLifecycleSelection(car.id)}
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-3">
                          <div className="font-semibold text-app">{carTitle || t("inventory.carFallback")}</div>
                          {car.grade && <div className="mt-0.5 text-[11px] text-[var(--color-accent)] font-medium">{car.grade}</div>}
                          {car.vin && (
                            <div className="mt-0.5 text-[11px] text-muted">{t("inventory.vinPrefix", { vin: car.vin })}</div>
                          )}
                          {isSupplierCar && car.supplier_name && (
                            <div className="mt-0.5 text-[11px] font-medium text-amber-600">
                              {t("inventory.supplierPrefix", { name: String(car.supplier_name) })}
                            </div>
                          )}
                          {car.purchase_order_id && (
                            <div className="mt-0.5 text-[11px] font-medium text-blue-700">
                              {t("inventory.poShort", {
                                id: car.purchase_order_id.slice(0, 8),
                                status: car.inventory_lifecycle_status || "IN_TRANSIT",
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted hidden sm:table-cell">
                          <div>
                            {car.color || t("common.emiDash")}
                            {car.body_type ? ` · ${car.body_type}` : ""}
                          </div>
                          {car.drive_type && <div className="text-[11px]">{car.drive_type}</div>}
                          {car.mileage != null && (
                            <div className="text-[11px]">
                              {t("inventory.km", {
                                n: formatNumberForLocale(locale, car.mileage, { maximumFractionDigits: 0 }),
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">
                          {car.location ? (
                            <Chip size="sm" variant="soft" className="h-5 w-fit max-w-full px-2 text-[10px]">
                              {isCarLocation(car.location)
                                ? carLocationOptionLabel(t, car.location)
                                : car.location}
                            </Chip>
                          ) : (
                            t("common.emiDash")
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1">
                            <Chip
                              size="sm"
                              variant="soft"
                              className={[
                                "h-5 w-fit max-w-full px-2 text-[10px] border border-transparent",
                                lifecycleStatusChipTone(coerceInventoryLifecycle(car.lifecycle_status)),
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              {inventoryLifecycleLabel(t, coerceInventoryLifecycle(car.lifecycle_status))}
                            </Chip>
                            {canEditLifecycle && !isInvestorReadOnly ? (
                              <select
                                className="w-full min-w-[8rem] max-w-[13rem] rounded-md border border-app bg-white px-2 py-1.5 text-[10px] text-app outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
                                value={coerceInventoryLifecycle(car.lifecycle_status)}
                                disabled={inventoryLifecycleSaving}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  if (
                                    !isCarLifecycleStatus(next) ||
                                    next === coerceInventoryLifecycle(car.lifecycle_status)
                                  ) {
                                    return;
                                  }
                                  updateInventoryLifecycle([car.id], next);
                                }}
                              >
                                {CAR_LIFECYCLE_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {inventoryLifecycleLabel(t, s)}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-app">
                          {isSupplierCar ? (
                            <span className="text-muted text-[11px]">{t("inventory.notTracked")}</span>
                          ) : (
                            <>
                              {formatMoneyLocale(locale, car.purchase_price, car.purchase_currency)}
                              {car.purchase_rate != null && (
                                <div className="mt-0.5 text-[11px] text-muted">
                                  {t("inventory.rateLabel", {
                                    rate: formatNumberForLocale(locale, car.purchase_rate, {
                                      maximumFractionDigits: 6,
                                    }),
                                  })}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <DisplayStatusBadge status={effectiveStatus} t={t} />
                        </td>
                        <td className="px-4 py-3">
                          <PublishedBadge published={car.is_published} t={t} />
                        </td>
                        <td className="px-4 py-3">
                          {isInvestorReadOnly ? (
                            <span className="text-[11px] text-muted">{t("inventory.viewOnlyRow")}</span>
                          ) : (
                          <RowActionsMenu label={t("inventory.rowActionsLabel")}>
                            <button
                              type="button"
                              onClick={() => openEditModal(car)}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePublishToggle(car)}
                              disabled={isPublishingId === car.id}
                              className={[
                                "rounded-md border px-3 py-1 text-[11px] font-semibold disabled:opacity-50 transition",
                                car.is_published
                                  ? "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                                  : "border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                              ].join(" ")}
                            >
                              {isPublishingId === car.id
                                ? "…"
                                : car.is_published
                                  ? t("inventory.unpublish")
                                  : t("inventory.publish")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarkSold(car)}
                              disabled={isMarkingSoldId === car.id}
                              className={[
                                "rounded-md border px-3 py-1 text-[11px] font-semibold disabled:opacity-50 transition",
                                effectiveStatus === "sold"
                                  ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50",
                              ].join(" ")}
                            >
                              {isMarkingSoldId === car.id
                                ? "…"
                                : effectiveStatus === "sold"
                                  ? `↩ ${t("inventory.restoreCar")}`
                                  : t("inventory.markSold")}
                            </button>
                            {isSupplierCar && (
                              <button
                                type="button"
                                onClick={() => handleConvertToAxira(car)}
                                disabled={isConvertingId === car.id}
                                className="rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5 px-3 py-1 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-50 transition"
                              >
                                {isConvertingId === car.id ? "…" : t("inventory.toAxiraStock")}
                              </button>
                            )}
                            {(!isSupplierCar || Boolean(car.purchase_order_id)) && !hasDealAlready && isPoCarEligibleForDeal(car) ? (
                              <Link
                                href={`/deals?addDeal=1&carId=${encodeURIComponent(car.id)}`}
                                className="inline-flex items-center justify-center rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                {t("inventory.createDeal")}
                              </Link>
                            ) : isSupplierCar && !car.purchase_order_id ? (
                              <button
                                type="button"
                                onClick={() => setCreateDealSupplierHint(t("inventory.supplierDealHint"))}
                                className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-400 hover:bg-gray-50"
                              >
                                {t("inventory.createDeal")}
                              </button>
                            ) : car.purchase_order_id && !isPoCarEligibleForDeal(car) ? (
                              <span className="rounded-md border border-app bg-gray-50 px-3 py-1 text-[11px] font-semibold text-gray-400">
                                {t("inventory.waitingArrival")}
                              </span>
                            ) : (
                              <span className="rounded-md border border-app bg-gray-50 px-3 py-1 text-[11px] font-semibold text-gray-400">
                                {t("inventory.dealExistsLabel")}
                              </span>
                            )}
                            {canDelete ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(car)}
                              disabled={isDeletingId === car.id}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
                            >
                              {isDeletingId === car.id ? t("inventory.deleting") : t("common.delete")}
                            </button>
                            ) : null}
                          </RowActionsMenu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredCars.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-app px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{t("inventory.rowsPerPage")}</span>
                  <select
                    value={carsPageSize}
                    onChange={(e) => setCarsPageSize(Number(e.target.value))}
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
                      start: (carsPage - 1) * carsPageSize + 1,
                      end: Math.min(carsPage * carsPageSize, filteredCars.length),
                      total: filteredCars.length,
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                <span className="text-xs text-muted">{t("inventory.pageOf", { page: carsPage, pages: carsPages })}</span>
                <Button type="button" size="sm" variant="outline" isDisabled={carsPage <= 1} onPress={() => setCarsPage((p) => Math.max(1, p - 1))}>
                  {t("inventory.pagerPrevious")}
                </Button>
                <Button type="button" size="sm" variant="outline" isDisabled={carsPage >= carsPages} onPress={() => setCarsPage((p) => Math.min(carsPages, p + 1))}>
                  {t("inventory.pagerNext")}
                </Button>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </PageContainer>

      {/* ── ADD / EDIT MODAL ── */}
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative w-full max-w-2xl rounded-lg border border-app surface p-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  {editingCarId
                    ? t("inventory.editCarTitle")
                    : form.stockType === "supplier"
                      ? t("inventory.addSupplierTitle")
                      : t("inventory.addCarTitle")}
                </div>
                <div className="text-xs text-muted">{t("inventory.fieldsRequiredHint")}</div>
              </div>
              <button type="button" onClick={closeModal} disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50">
                {t("common.close")}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">

              {/* ── STOCK TYPE ── */}
              {sectionHeader(t("inventory.stockTypeHeading"))}
              <div className="sm:col-span-2 flex gap-3">
                {(["axira", "supplier"] as const).map((type) => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer text-xs">
                    <input type="radio" name="stockType" value={type} checked={form.stockType === type}
                      onChange={() => updateField("stockType", type)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="font-semibold">
                      {type === "axira" ? `⚡ ${t("inventory.axiraStockRadio")}` : `🏷️ ${t("inventory.supplierListingRadio")}`}
                    </span>
                    <span className="text-muted">
                      {type === "axira" ? t("inventory.axiraStockBlurb") : t("inventory.supplierListingBlurb")}
                    </span>
                  </label>
                ))}
              </div>
              {form.stockType === "supplier" && (
                <label className={`${labelCls} sm:col-span-2`}>
                  <span className="font-semibold">
                    {t("inventory.supplierNameLabel")} <span className="text-[var(--color-accent)]">*</span>
                  </span>
                  <input value={form.supplierName} onChange={(e) => updateField("supplierName", e.target.value)}
                    placeholder={t("inventory.supplierNamePlaceholder")} className={inputCls} />
                </label>
              )}

              {/* ── VEHICLE DETAILS ── */}
              {sectionHeader(t("inventory.vehicleDetailsHeading"))}

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.brand")}</span>
                <select value={form.brand} onChange={(e) => updateField("brand", e.target.value)} className={inputCls}>
                  {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.model")}</span>
                <input value={form.model} onChange={(e) => updateField("model", e.target.value)}
                  placeholder={t("inventory.modelPlaceholder")} className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.year")}</span>
                <select value={form.year} onChange={(e) => updateField("year", e.target.value)} className={inputCls}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">
                  {t("inventory.color")} <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input value={form.color} onChange={(e) => updateField("color", e.target.value)}
                  placeholder={t("inventory.colorPlaceholder")} className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">
                  {t("inventory.mileageKmLabel")} <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input type="number" value={form.mileage} onChange={(e) => updateField("mileage", e.target.value)}
                  placeholder={t("inventory.mileagePlaceholder")} className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.vinOptional")}</span>
                <input value={form.vin} onChange={(e) => updateField("vin", e.target.value)}
                  placeholder={t("inventory.vinChassisPlaceholder")} className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">
                  {t("inventory.shipsFrom")}{" "}
                  <span className="text-gray-400 font-normal text-xs">{t("inventory.shipsFromHint")}</span>
                </span>
                <select value={form.countryOfOrigin} onChange={(e) => updateField("countryOfOrigin", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectExportLocation")}</option>
                  <option value="UAE">UAE / Émirats Arabes Unis</option>
                  <option value="Europe">Europe</option>
                  <option value="China">China / Chine</option>
                  <option value="Korea">Korea / Corée</option>
                </select>
              </label>

              {/* ── SPECIFICATIONS ── */}
              {sectionHeader(t("inventory.specificationsHeading"))}

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.bodyTypeLabel")}</span>
                <select value={form.bodyType} onChange={(e) => updateField("bodyType", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectOption")}</option>
                  {["SUV","Sedan","Pickup","Coupe","Hatchback","Van","Minivan","Convertible","Wagon"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.driveTypeLabel")}</span>
                <select value={form.driveType} onChange={(e) => updateField("driveType", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectOption")}</option>
                  {["4WD","AWD","2WD / FWD","RWD"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.transmissionLabel")}</span>
                <select value={form.transmission} onChange={(e) => updateField("transmission", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectOption")}</option>
                  <option value="Automatic">{t("inventory.transmissionAuto")}</option>
                  <option value="Manual">{t("inventory.transmissionManual")}</option>
                  <option value="CVT">{t("inventory.transmissionCvt")}</option>
                  <option value="Semi-Auto">{t("inventory.transmissionSemi")}</option>
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.fuelTypeLabel")}</span>
                <select value={form.fuelType} onChange={(e) => updateField("fuelType", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectOption")}</option>
                  <option value="Petrol">{t("inventory.fuelPetrol")}</option>
                  <option value="Diesel">{t("inventory.fuelDiesel")}</option>
                  <option value="Hybrid">{t("inventory.fuelHybrid")}</option>
                  <option value="Electric">{t("inventory.fuelElectric")}</option>
                  <option value="Plug-in Hybrid">{t("inventory.fuelPluginHybrid")}</option>
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.engineLabel")}</span>
                <input value={form.engine} onChange={(e) => updateField("engine", e.target.value)}
                  placeholder={t("inventory.enginePlaceholder")} className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.gradeTrim")}</span>
                <input value={form.grade} onChange={(e) => updateField("grade", e.target.value)}
                  placeholder={t("inventory.gradePlaceholder")} className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.doorsLabel")}</span>
                <select value={form.doors} onChange={(e) => updateField("doors", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectOption")}</option>
                  {["2","3","4","5"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.seatsLabel")}</span>
                <select value={form.seats} onChange={(e) => updateField("seats", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectOption")}</option>
                  {["2","4","5","6","7","8","9"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>

              {/* ── CONDITION ── */}
              {sectionHeader(t("inventory.conditionFeaturesHeading"))}

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.conditionLabel")}</span>
                <select value={form.condition} onChange={(e) => updateField("condition", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.selectOption")}</option>
                  <option value="Brand New">{t("inventory.conditionBrandNew")}</option>
                  <option value="Used">{t("inventory.conditionUsed")}</option>
                </select>
              </label>

              <label className={`${labelCls} sm:col-span-2`}>
                <span className="font-semibold">{t("inventory.bodyIssuesOptional")}</span>
                <textarea value={form.bodyIssues} onChange={(e) => updateField("bodyIssues", e.target.value)}
                  placeholder={t("inventory.bodyIssuesPlaceholder")}
                  rows={2}
                  className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className={`${labelCls} sm:col-span-2`}>
                <span className="font-semibold">{t("inventory.featuresCommaSeparated")}</span>
                <input value={form.features} onChange={(e) => updateField("features", e.target.value)}
                  placeholder={t("inventory.featuresPlaceholder")}
                  className={inputCls} />
              </label>

              {/* ── PRICING & FINANCIALS ── */}
              {!isSupplier && sectionHeader(t("inventory.purchaseFinancialsHeading"), t("inventory.purchaseFinancialsSub"))}
              {isSupplier && sectionHeader(t("inventory.listingPriceHeading"), t("inventory.listingPriceSubSupplier"))}

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.purchasePriceLabel")}</span>
                <input type="number" value={form.purchasePrice} onChange={(e) => updateField("purchasePrice", e.target.value)}
                  placeholder={t("inventory.purchasePricePlaceholder")} className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.currencyLabel")}</span>
                <select value={form.purchaseCurrency}
                  onChange={(e) => updateField("purchaseCurrency", e.target.value as "AED" | "DZD" | "USD" | "EUR")}
                  className={inputCls}>
                  <option value="AED">AED</option>
                  <option value="DZD">DZD</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              {showRate ? (
                  <label className={labelCls}>
                  <span className="font-semibold">{t("inventory.purchaseRate")} <span className="text-[var(--color-accent)]">*</span></span>
                  <input type="number" value={form.purchaseRate} onChange={(e) => updateField("purchaseRate", e.target.value)}
                    placeholder={
                      form.purchaseCurrency === "DZD"
                        ? t("inventory.ratePlaceholderDzd")
                        : form.purchaseCurrency === "USD"
                          ? t("inventory.ratePlaceholderUsd")
                          : t("inventory.ratePlaceholderEur")
                    }
                    className={inputCls} />
                </label>
              ) : <div className="hidden sm:block" />}

              {!isSupplier && (
                <>
                  <label className={labelCls}>
                    <span className="font-semibold">{t("inventory.paidToSupplierLabel")}</span>
                    <input type="number" value={form.amountPaidToSupplier}
                      onChange={(e) => updateField("amountPaidToSupplier", e.target.value)}
                      placeholder={t("inventory.paidToSupplierDefaultsHint")} className={inputCls} />
                  </label>

                  <label className={labelCls}>
                    <span className="font-semibold">{t("inventory.supplierOwedLabel")}</span>
                    <input type="text" readOnly
                      value={(() => {
                        const p = form.purchasePrice.trim() ? Number(form.purchasePrice) : 0;
                        const paid = form.amountPaidToSupplier.trim() ? Number(form.amountPaidToSupplier) : p;
                        return p > 0
                          ? formatNumberForLocale(locale, Math.max(0, p - paid), { maximumFractionDigits: 0 })
                          : t("common.emiDash");
                      })()}
                      className="w-full rounded-md border border-app bg-gray-50 px-3 py-2 text-sm text-muted"
                    />
                  </label>

                  {showPaidFromPocket && (
                    <label className={labelCls}>
                      <span className="font-semibold">
                        {t("inventory.paidFromPocketLabel")} <span className="text-[var(--color-accent)]">*</span>
                      </span>
                      <select value={form.paidFromPocket}
                        onChange={(e) => updateField("paidFromPocket", e.target.value as PaidPocket | "")}
                        className={inputCls}>
                        <option value="">{t("inventory.selectPocket")}</option>
                        {(form.purchaseCurrency === "AED" ? AED_POCKETS : form.purchaseCurrency === "DZD" ? DZD_POCKETS : EUR_POCKETS).map((p) => (
                          <option key={p} value={p}>{pocketDetailLabel(t, p)}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              {/* ── LOCATION & OWNER ── */}
              {sectionHeader(t("inventory.locationOwnerHeading"))}

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.location")}</span>
                <select
                  value={form.location}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateField("location", v === "" ? "" : isCarLocation(v) ? v : form.location);
                  }}
                  className={inputCls}
                >
                  <option value="">{t("inventory.locationNone")}</option>
                  {CAR_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {carLocationOptionLabel(t, loc)}
                    </option>
                  ))}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.owner")}</span>
                <select value={form.owner} onChange={(e) => updateField("owner", e.target.value as "Axira" | "Client")} className={inputCls}>
                  <option value="Axira">{t("inventory.ownerAxira")}</option>
                  <option value="Client">{t("inventory.ownerClient")}</option>
                </select>
              </label>

              {showClientName && (
                <label className={`${labelCls} sm:col-span-2`}>
                  <span className="font-semibold">
                    {t("inventory.clientNameLabel")} <span className="text-[var(--color-accent)]">*</span>
                  </span>
                  <input value={form.clientName} onChange={(e) => updateField("clientName", e.target.value)}
                    placeholder={t("inventory.clientName")} className={inputCls} />
                </label>
              )}

              {/* ── LISTING PRICE ── */}
              {sectionHeader(t("inventory.listingPriceHeading"))}

              <label className={`${labelCls} sm:col-span-2`}>
                <span className="font-semibold">
                  {t("inventory.salePriceDzdLabel")}{" "}
                  <span className="text-gray-400 font-normal text-xs">{t("inventory.salePriceDzdHint")}</span>
                </span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={form.salePriceDzd}
                  onChange={(e) => updateField("salePriceDzd", e.target.value)}
                  placeholder={t("inventory.salePricePlaceholder")}
                  className={inputCls}
                />
              </label>

              {canEditSalesListMeta ? (
                <>
                  {sectionHeader(t("inventory.algeriaSalesListHeading"))}
                  <label className={labelCls}>
                    <span className="font-semibold">{t("inventory.leadTimeDays")}</span>
                    <input
                      type="number"
                      min="0"
                      value={form.salesLeadTimeDays}
                      onChange={(e) => updateField("salesLeadTimeDays", e.target.value)}
                      placeholder={t("inventory.leadTimePlaceholder")}
                      className={inputCls}
                    />
                  </label>
                  <label className={labelCls}>
                    <span className="font-semibold">{t("inventory.depositDzd")}</span>
                    <input
                      type="number"
                      min="0"
                      value={form.salesDepositDzd}
                      onChange={(e) => updateField("salesDepositDzd", e.target.value)}
                      placeholder={t("inventory.depositPlaceholder")}
                      className={inputCls}
                    />
                  </label>
                  <label className={`${labelCls} sm:col-span-2`}>
                    <span className="font-semibold">{t("inventory.costEstimateDzdField")}</span>
                    <input
                      type="number"
                      min="0"
                      value={form.salesCostEstimateDzd}
                      onChange={(e) => updateField("salesCostEstimateDzd", e.target.value)}
                      placeholder={t("inventory.costEstimatePlaceholder")}
                      className={inputCls}
                    />
                  </label>
                  <label className={`${labelCls} sm:col-span-2`}>
                    <span className="font-semibold">{t("inventory.internalNoteSalesList")}</span>
                    <textarea
                      value={form.salesInternalNote}
                      onChange={(e) => updateField("salesInternalNote", e.target.value)}
                      placeholder={t("inventory.internalNotePlaceholder")}
                      rows={2}
                      className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>
                </>
              ) : null}

              {/* ── SALES NOTES (shared with sales list) ── */}
              {sectionHeader(t("inventory.salesNotesHeading"))}
              <div className="sm:col-span-2">
                {editingCarId ? (
                  <SalesNotesField
                    value={form.salesNotes}
                    onChange={(v) => updateField("salesNotes", v)}
                    readOnly={!canEditSalesListMeta}
                    lastUpdatedAt={form.salesNotesUpdatedAt}
                    lastUpdatedByName={form.salesNotesUpdatedByName}
                    onSave={async (text) => {
                      const res = await fetch(`/api/sales-list/cars/${encodeURIComponent(editingCarId)}/notes`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sales_notes: text }),
                      });
                      const data = (await res.json().catch(() => ({}))) as SalesNotesSaveResult & { error?: string };
                      if (!res.ok) throw new Error(data.error || t("inventory.failedSaveShort"));
                      setForm((prev) => ({
                        ...prev,
                        salesNotesUpdatedAt: data.sales_notes_updated_at ?? null,
                        salesNotesUpdatedByName: data.sales_notes_updated_by_name ?? null,
                        salesNotes: data.sales_notes ?? prev.salesNotes,
                      }));
                      return data;
                    }}
                  />
                ) : (
                  <label className={labelCls}>
                    <span className="font-semibold">{t("inventory.salesNotesFieldLabel")}</span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {t("inventory.salesNotesAddOnlyHint")}
                    </span>
                    <textarea
                      value={form.salesNotes}
                      onChange={(e) => updateField("salesNotes", e.target.value)}
                      placeholder={t("inventory.salesNotesPlaceholder")}
                      rows={3}
                      className="mt-1 w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>
                )}
              </div>

              {/* ── PUBLISHING & STATUS ── */}
              {sectionHeader(t("inventory.publishingStatusHeading"))}

              <div className="sm:col-span-2 flex flex-wrap gap-4 items-center">
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input type="checkbox" checked={form.isPublished}
                    onChange={(e) => updateField("isPublished", e.target.checked)}
                    className="accent-[var(--color-accent)] w-4 h-4" />
                  <span className="font-semibold">{t("inventory.publishedPublicLabel")}</span>
                  <span className="text-muted">{t("inventory.publishedPublicHint")}</span>
                </label>
              </div>

              <label className={labelCls}>
                <span className="font-semibold">{t("inventory.statusOverride")}</span>
                <select value={form.statusOverride} onChange={(e) => updateField("statusOverride", e.target.value)} className={inputCls}>
                  <option value="">{t("inventory.statusAuto")}</option>
                  <option value="available">{t("inventory.statusForceAvailable")}</option>
                  <option value="in_transit">{t("inventory.statusForceInTransit")}</option>
                  <option value="sold">{t("inventory.statusForceSold")}</option>
                </select>
              </label>

              {/* ── NOTES ── */}
              {sectionHeader(t("inventory.notesHeading"))}

              <div className="sm:col-span-2">
                <label className={labelCls}>
                  <span className="font-semibold">{t("deals.notes")}</span>
                  <textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)}
                    placeholder={t("inventory.internalNotesPlaceholder")} rows={3}
                    className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </div>

              {canEditLifecycle && editingCarId ? (
                <div className="sm:col-span-2 rounded-md border border-app bg-black/[0.02] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleCarAuditSection()}
                    className="flex w-full items-center justify-between text-left text-xs font-semibold text-app hover:bg-black/[0.03]"
                  >
                    <span>{t("inventory.historyAudit")}</span>
                    <span aria-hidden>{carHistoryOpen ? "▼" : "►"}</span>
                  </button>
                  {carHistoryOpen ? (
                    <div className="mt-2 space-y-2 border-t border-app/60 pt-2">
                      {carHistoryError ? (
                        <Alert.Root status="danger">
                          <Alert.Content>
                            <Alert.Description>{carHistoryError}</Alert.Description>
                          </Alert.Content>
                        </Alert.Root>
                      ) : null}
                      {carHistoryLoading && carHistoryRows.length === 0 ? (
                        <div className="flex items-center gap-2 text-[11px] text-muted">
                          <Spinner size="sm" color="danger" />
                          {t("inventory.loadingShort")}
                        </div>
                      ) : carHistoryRows.length === 0 ? (
                        <p className="text-[11px] text-muted">{t("inventory.noAuditYet")}</p>
                      ) : (
                        <div className="max-h-[14rem] space-y-1.5 overflow-y-auto text-[11px]">
                          {carHistoryRows.map((row) => (
                            <div
                              key={row.id}
                              className="rounded border border-app bg-white px-2 py-1.5 text-app"
                            >
                              <div className="flex flex-wrap justify-between gap-1 font-medium">
                                <span className="text-[var(--color-accent)]">{row.field_name}</span>
                                <span className="text-muted">
                                  {formatDateForLocale(locale, row.changed_at, {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })}
                                </span>
                              </div>
                              <div className="mt-1 text-muted">
                                {row.old_value != null && row.old_value !== "" ? (
                                  <>
                                    <span title={row.old_value} className="line-clamp-2 break-all">
                                      {row.old_value}
                                    </span>
                                    <span className="mx-1 font-semibold text-app">→</span>
                                  </>
                                ) : (
                                  <span className="text-muted italic">∅ · </span>
                                )}
                                <span title={row.new_value} className="break-all font-medium text-app">
                                  {row.new_value}
                                </span>
                              </div>
                              {row.reason ? (
                                <div className="mt-1 text-[10px] italic text-muted">
                                  {t("inventory.auditReason", { reason: row.reason })}
                                </div>
                              ) : null}
                              <div className="mt-0.5 font-mono text-[10px] text-muted">
                                {t("inventory.auditBy", { id: `${(row.changed_by || "?").slice(0, 8)}…` })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {carHistoryHasMore ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-1 h-8 w-full text-[11px]"
                          isDisabled={carHistoryLoading || !editingCarId}
                          onPress={() =>
                            editingCarId && void fetchCarAuditHistory({ offset: carHistoryRows.length })
                          }
                        >
                          {carHistoryLoading ? t("inventory.loadingShort") : t("inventory.loadMore")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ── PHOTOS ── */}
              {sectionHeader(t("inventory.photosHeading"))}

              <div className="sm:col-span-2 space-y-2 text-xs text-app">
                {carPhotos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {carPhotos.map((url, i) => (
                      <div key={url} className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={t("inventory.photoAlt", { n: i + 1 })}
                          className="h-20 w-20 rounded-md object-cover border border-app" />
                        <button type="button" onClick={() => handleDeletePhoto(url, i)}
                          className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-5 h-5 bg-red-600 text-white rounded-full text-[11px] font-bold">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="block cursor-pointer">
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => e.target.files && handlePhotoUpload(e.target.files)}
                    disabled={isUploadingPhoto} />
                  <div className={["rounded-md border border-dashed border-app p-3 text-center text-muted transition",
                    isUploadingPhoto ? "opacity-60 cursor-not-allowed" : "hover:border-[var(--color-accent)] hover:text-app cursor-pointer"].join(" ")}>
                    {isUploadingPhoto ? t("inventory.uploading") : carPhotos.length > 0 ? t("inventory.addMorePhotos") : t("inventory.clickUploadPhotos")}
                  </div>
                </label>
              </div>

            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" size="sm" isDisabled={isSaving} onPress={closeModal}>
                {t("common.cancel")}
              </Button>
              <Button type="button" variant="primary" size="sm" isDisabled={isSaving} onPress={handleSave}>
                {isSaving ? t("inventory.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
