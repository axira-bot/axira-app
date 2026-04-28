"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Car } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

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
  location: "Dubai Showroom" | "Algeria Showroom" | "In Transit";
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
  location: "Dubai Showroom",
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
});

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const c = currency || "";
  return `${formatNumber(v)}${c ? ` ${c}` : ""}`;
}

function getEffectiveStatus(car: Car): string {
  if (car.status_override) return car.status_override;
  if (car.display_status) return car.display_status;
  return car.status || "available";
}

type StockTypeTab = "axira" | "supplier";
type FilterTab = "All" | "Dubai" | "Algeria" | "In Transit" | "Sold";
type ConditionTab = "brand_new" | "used";

function normalizeCondition(condition: string | null | undefined): string {
  return (condition || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isBrandNewCondition(condition: string | null | undefined): boolean {
  const normalized = normalizeCondition(condition);
  return normalized === "brand new" || normalized === "new";
}

function DisplayStatusBadge({ status }: { status: string }) {
  if (status === "sold") return (
    <span className="inline-flex rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
      Sold
    </span>
  );
  if (status === "in_transit") return (
    <span className="inline-flex rounded-full border border-blue-400 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
      In Transit · For Sale
    </span>
  );
  return (
    <span className="inline-flex rounded-full border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[11px] font-semibold text-white">
      Available
    </span>
  );
}

function PublishedBadge({ published }: { published: boolean | null | undefined }) {
  if (published) return (
    <span className="inline-flex rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      Live
    </span>
  );
  return (
    <span className="inline-flex rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
      Draft
    </span>
  );
}

const inputCls = "w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]";
const labelCls = "space-y-1 text-xs text-app";

export default function InventoryPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [carIdsWithDeals, setCarIdsWithDeals] = useState<Set<string>>(new Set());
  const [stockTypeTab, setStockTypeTab] = useState<StockTypeTab>("axira");
  const [conditionTab, setConditionTab] = useState<ConditionTab>("brand_new");
  const [activeTab, setActiveTab] = useState<FilterTab>("All");

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
    const [{ data, error: fetchError }, { data: dealsData, error: dealsError }] = await Promise.all([
      supabase
        .from("cars")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("deals").select("car_id").not("car_id", "is", null),
    ]);

    if (fetchError || dealsError) {
      setError("Failed to load cars.");
      setCars([]);
      setCarIdsWithDeals(new Set());
      setIsLoading(false);
      return;
    }
    setCars((data as Car[]) ?? []);
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

  // Filter by stock type first, then by location/status tab
  const filteredCars = useMemo(() => {
    const byStock = cars.filter((c) => (c.stock_type || "axira") === stockTypeTab);
    const byCondition = byStock.filter((c) =>
      conditionTab === "brand_new" ? isBrandNewCondition(c.condition) : !isBrandNewCondition(c.condition)
    );
    const effectiveStatus = (c: Car) => getEffectiveStatus(c).toLowerCase();

    if (activeTab === "Sold") return byCondition.filter((c) => effectiveStatus(c) === "sold");
    if (activeTab === "Dubai") return byCondition.filter((c) => c.location === "Dubai Showroom");
    if (activeTab === "Algeria") return byCondition.filter((c) => c.location === "Algeria Showroom");
    if (activeTab === "In Transit") return byCondition.filter((c) => effectiveStatus(c) === "in_transit" || c.location === "In Transit");
    return byCondition;
  }, [activeTab, conditionTab, stockTypeTab, cars]);

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
      location: (car.location as "Dubai Showroom" | "Algeria Showroom" | "In Transit") || "Dubai Showroom",
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
    });
    setIsModalOpen(true);
    setError(null);
  };

  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
  };

  const updateField = <K extends keyof CarFormState>(key: K, value: CarFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.color.trim()) return "Color is required.";
    if (!form.mileage.trim()) return "Mileage is required.";
    const mileage = Number(form.mileage);
    if (Number.isNaN(mileage) || mileage < 0) return "Mileage must be a valid number.";
    if (showClientName && !form.clientName.trim()) return "Client Name is required when Owner is Client.";
    if (showRate) {
      if (!form.purchaseRate.trim()) return "Purchase Rate is required for DZD, USD or EUR purchases.";
      const rate = Number(form.purchaseRate);
      if (Number.isNaN(rate) || rate <= 0) return "Purchase Rate must be a valid number.";
    }
    if (form.purchasePrice.trim()) {
      const price = Number(form.purchasePrice);
      if (Number.isNaN(price) || price < 0) return "Purchase Price must be a valid number.";
    }
    if (showPaidFromPocket && !form.paidFromPocket) {
      return '"Paid From Pocket" is required when supplier is paid.';
    }
    if (form.stockType === "supplier" && !form.supplierName.trim()) {
      return "Supplier name is required for supplier listings.";
    }
    return null;
  };

  const handlePhotoUpload = async (files: FileList) => {
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
    const marker = "/car-photos/";
    const markerIdx = url.indexOf(marker);
    if (markerIdx !== -1) {
      const storagePath = url.slice(markerIdx + marker.length);
      await supabase.storage.from("car-photos").remove([storagePath]);
    }
    setCarPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
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
      location: form.location,
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
      // Stock & publishing
      stock_type: form.stockType,
      supplier_name: form.stockType === "supplier" ? form.supplierName : null,
      is_published: form.isPublished,
      status_override: form.statusOverride || null,
    };

    const carLabel = `${form.brand} ${form.model} ${form.year}`.trim();
    if (editingCarId) {
      const { error: updateError } = await supabase.from("cars").update(payload).eq("id", editingCarId);
      if (updateError) {
        setError(["Failed to update car.", updateError.message, updateError.details, updateError.hint].filter(Boolean).join(" "));
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
      const { data: inserted, error: insertError } = await supabase.from("cars").insert(payload).select("id").single();
      if (insertError) {
        setError(["Failed to add car.", insertError.message, insertError.details, insertError.hint].filter(Boolean).join(" "));
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
          setError(["Car saved, but failed to create purchase movement.", movementError.message].filter(Boolean).join(" "));
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
    }

    await fetchCars();
    setIsSaving(false);
    setIsModalOpen(false);
  };

  const handleDelete = async (car: Car) => {
    const name = `${car.brand || ""} ${car.model || ""}`.trim() || "this car";
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;

    setIsDeletingId(car.id);
    setError(null);

    const { data: dealRows } = await supabase.from("deals").select("id").eq("car_id", car.id).limit(1);
    if (dealRows && dealRows.length > 0) {
      setError("Cannot delete car with an active deal. Delete the deal first.");
      setIsDeletingId(null);
      return;
    }

    const { data: containerCarRows } = await supabase.from("container_cars").select("id").eq("car_id", car.id).limit(1);
    if (containerCarRows && containerCarRows.length > 0) {
      setError("Cannot delete car inside a container. Remove from container first.");
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
      setError("Failed to delete car.");
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
    setIsPublishingId(car.id);
    const newValue = !car.is_published;
    const { error: err } = await supabase.from("cars").update({ is_published: newValue }).eq("id", car.id);
    if (!err) {
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, is_published: newValue } : c));
    }
    setIsPublishingId(null);
  };

  const handleMarkSold = async (car: Car) => {
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
          `Cannot restore: "${car.brand} ${car.model}" has an active deal` +
          (activeDeal.client_name ? ` with ${activeDeal.client_name}` : "") +
          `. Delete the deal first to make this car available again.`
        );
        return;
      }
      if (!window.confirm("Mark this car as Available again?")) return;
      setIsMarkingSoldId(car.id);
      await supabase.from("cars").update({ display_status: "available", sold_at: null, status: "available", status_override: null }).eq("id", car.id);
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, display_status: "available", sold_at: null, status: "available", status_override: null } : c));
    } else {
      if (!window.confirm("Mark this car as Sold?")) return;
      setIsMarkingSoldId(car.id);
      const now = new Date().toISOString();
      await supabase.from("cars").update({ display_status: "sold", sold_at: now, status: "sold" }).eq("id", car.id);
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, display_status: "sold", sold_at: now, status: "sold" } : c));
    }
    setIsMarkingSoldId(null);
  };

  const handleConvertToAxira = async (car: Car) => {
    if (!window.confirm(`Convert "${car.brand} ${car.model} ${car.year}" from Supplier Listing to AXIRA Stock? This will include it in financial reports.`)) return;
    setIsConvertingId(car.id);
    const { error: err } = await supabase.from("cars").update({ stock_type: "axira", supplier_name: null }).eq("id", car.id);
    if (!err) {
      setCars((prev) => prev.map((c) => c.id === car.id ? { ...c, stock_type: "axira", supplier_name: null } : c));
    }
    setIsConvertingId(null);
  };

  const filterTabLabels: Record<FilterTab, string> = {
    All: "All",
    Dubai: "Dubai",
    Algeria: "Algeria",
    "In Transit": "In Transit",
    Sold: "Sold",
  };

  const sectionHeader = (title: string, sub?: string) => (
    <div className="sm:col-span-2 mt-2 border-b border-app pb-1">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">{title}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Inventory</h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">Vehicle Management</p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="btn-primary inline-flex items-center justify-center px-4 py-2 text-sm font-semibold"
          >
            + Add {stockTypeTab === "supplier" ? "Supplier Listing" : "Car"}
          </button>
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
            AXIRA Stock ({axiraCount})
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
            Supplier Listings ({supplierCount})
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
            Brand New ({stockCountsByCondition.brandNew})
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
            Used ({stockCountsByCondition.used})
          </button>
        </div>

        {stockTypeTab === "supplier" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠️ Supplier listings are <strong>not included in financial reports</strong>. To record a sale, first convert the car to AXIRA Stock.
          </div>
        )}

        {/* Location / status filter tabs */}
        <div className="flex flex-wrap gap-2">
          {(["All", "Dubai", "Algeria", "In Transit", "Sold"] as FilterTab[]).map((tab) => (
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
              {filterTabLabels[tab]}
            </button>
          ))}
        </div>

        {createDealSupplierHint && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {createDealSupplierHint}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-app surface px-3 py-2 text-xs text-app">{error}</div>
        )}

        <div className="rounded-lg border border-app surface">
          {isLoading ? (
            <div className="p-4 text-sm text-muted">Loading cars...</div>
          ) : filteredCars.length === 0 ? (
            <div className="p-4 text-sm text-muted">No cars found.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[780px] w-full text-left text-xs rtl:text-right">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Car</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Specs</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Location</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Published</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCars.map((car) => {
                    const carTitle = `${car.brand || ""} ${car.model || ""} ${car.year || ""}`.trim();
                    const effectiveStatus = getEffectiveStatus(car).toLowerCase();
                    const isSupplierCar = car.stock_type === "supplier";
                    const hasDealAlready = carIdsWithDeals.has(car.id);
                    return (
                      <tr key={car.id} className={["border-b border-app last:border-b-0", isSupplierCar ? "bg-amber-50/30" : ""].join(" ")}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-app">{carTitle || "Car"}</div>
                          {car.grade && <div className="mt-0.5 text-[11px] text-[var(--color-accent)] font-medium">{car.grade}</div>}
                          {car.vin && <div className="mt-0.5 text-[11px] text-muted">VIN: {car.vin}</div>}
                          {isSupplierCar && car.supplier_name && (
                            <div className="mt-0.5 text-[11px] font-medium text-amber-600">Supplier: {car.supplier_name}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted hidden sm:table-cell">
                          <div>{car.color || "-"}{car.body_type ? ` · ${car.body_type}` : ""}</div>
                          {car.drive_type && <div className="text-[11px]">{car.drive_type}</div>}
                          {car.mileage != null && <div className="text-[11px]">{formatNumber(car.mileage)} km</div>}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">{car.location || "-"}</td>
                        <td className="px-4 py-3 text-app">
                          {isSupplierCar ? (
                            <span className="text-muted text-[11px]">Not tracked</span>
                          ) : (
                            <>
                              {formatMoney(car.purchase_price, car.purchase_currency)}
                              {car.purchase_rate != null && (
                                <div className="mt-0.5 text-[11px] text-muted">Rate: {formatNumber(car.purchase_rate)}</div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <DisplayStatusBadge status={effectiveStatus} />
                        </td>
                        <td className="px-4 py-3">
                          <PublishedBadge published={car.is_published} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(car)}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Edit
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
                              {isPublishingId === car.id ? "..." : car.is_published ? "Unpublish" : "Publish"}
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
                              {isMarkingSoldId === car.id ? "..." : effectiveStatus === "sold" ? "↩ Restore" : "Mark Sold"}
                            </button>
                            {isSupplierCar && (
                              <button
                                type="button"
                                onClick={() => handleConvertToAxira(car)}
                                disabled={isConvertingId === car.id}
                                className="rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5 px-3 py-1 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-50 transition"
                              >
                                {isConvertingId === car.id ? "..." : "→ AXIRA Stock"}
                              </button>
                            )}
                            {!isSupplierCar && !hasDealAlready ? (
                              <Link
                                href={`/deals?addDeal=1&carId=${encodeURIComponent(car.id)}`}
                                className="inline-flex items-center justify-center rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                Create Deal
                              </Link>
                            ) : isSupplierCar ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setCreateDealSupplierHint(
                                    "Supplier listings cannot be used for deals. Use \"→ AXIRA Stock\" first, then use Create Deal on the AXIRA stock row."
                                  )
                                }
                                className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-400 hover:bg-gray-50"
                              >
                                Create Deal
                              </button>
                            ) : (
                              <span className="rounded-md border border-app bg-gray-50 px-3 py-1 text-[11px] font-semibold text-gray-400">
                                Deal Exists
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(car)}
                              disabled={isDeletingId === car.id}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
                            >
                              {isDeletingId === car.id ? "Deleting..." : "Delete"}
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

      {/* ── ADD / EDIT MODAL ── */}
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative w-full max-w-2xl rounded-lg border border-app surface p-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  {editingCarId ? "Edit Car" : form.stockType === "supplier" ? "Add Supplier Listing" : "Add Car"}
                </div>
                <div className="text-xs text-muted">Fields marked * are required.</div>
              </div>
              <button type="button" onClick={closeModal} disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50">
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">

              {/* ── STOCK TYPE ── */}
              {sectionHeader("Stock Type")}
              <div className="sm:col-span-2 flex gap-3">
                {(["axira", "supplier"] as const).map((type) => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer text-xs">
                    <input type="radio" name="stockType" value={type} checked={form.stockType === type}
                      onChange={() => updateField("stockType", type)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="font-semibold">
                      {type === "axira" ? "⚡ AXIRA Stock" : "🏷️ Supplier Listing"}
                    </span>
                    <span className="text-muted">
                      {type === "axira" ? "(owned, in reports)" : "(external, listing only)"}
                    </span>
                  </label>
                ))}
              </div>
              {form.stockType === "supplier" && (
                <label className={`${labelCls} sm:col-span-2`}>
                  <span className="font-semibold">Supplier Name <span className="text-[var(--color-accent)]">*</span></span>
                  <input value={form.supplierName} onChange={(e) => updateField("supplierName", e.target.value)}
                    placeholder="e.g. Dubai Motors, Al Habtoor..." className={inputCls} />
                </label>
              )}

              {/* ── VEHICLE DETAILS ── */}
              {sectionHeader("Vehicle Details")}

              <label className={labelCls}>
                <span className="font-semibold">Brand</span>
                <select value={form.brand} onChange={(e) => updateField("brand", e.target.value)} className={inputCls}>
                  {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Model</span>
                <input value={form.model} onChange={(e) => updateField("model", e.target.value)}
                  placeholder="e.g. Prado" className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Year</span>
                <select value={form.year} onChange={(e) => updateField("year", e.target.value)} className={inputCls}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Color <span className="text-[var(--color-accent)]">*</span></span>
                <input value={form.color} onChange={(e) => updateField("color", e.target.value)}
                  placeholder="e.g. Pearl White" className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Mileage (km) <span className="text-[var(--color-accent)]">*</span></span>
                <input type="number" value={form.mileage} onChange={(e) => updateField("mileage", e.target.value)}
                  placeholder="e.g. 54000" className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">VIN (optional)</span>
                <input value={form.vin} onChange={(e) => updateField("vin", e.target.value)}
                  placeholder="Chassis number" className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Ships From <span className="text-gray-400 font-normal text-xs">(export location — sets public site tab)</span></span>
                <select value={form.countryOfOrigin} onChange={(e) => updateField("countryOfOrigin", e.target.value)} className={inputCls}>
                  <option value="">— Select export location —</option>
                  <option value="UAE">UAE / Émirats Arabes Unis</option>
                  <option value="Europe">Europe</option>
                  <option value="China">China / Chine</option>
                  <option value="Korea">Korea / Corée</option>
                </select>
              </label>

              {/* ── SPECIFICATIONS ── */}
              {sectionHeader("Specifications")}

              <label className={labelCls}>
                <span className="font-semibold">Body Type</span>
                <select value={form.bodyType} onChange={(e) => updateField("bodyType", e.target.value)} className={inputCls}>
                  <option value="">Select...</option>
                  {["SUV","Sedan","Pickup","Coupe","Hatchback","Van","Minivan","Convertible","Wagon"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Drive Type</span>
                <select value={form.driveType} onChange={(e) => updateField("driveType", e.target.value)} className={inputCls}>
                  <option value="">Select...</option>
                  {["4WD","AWD","2WD / FWD","RWD"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Transmission</span>
                <select value={form.transmission} onChange={(e) => updateField("transmission", e.target.value)} className={inputCls}>
                  <option value="">Select...</option>
                  <option value="Automatic">Automatic</option>
                  <option value="Manual">Manual</option>
                  <option value="CVT">CVT</option>
                  <option value="Semi-Auto">Semi-Auto</option>
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Fuel Type</span>
                <select value={form.fuelType} onChange={(e) => updateField("fuelType", e.target.value)} className={inputCls}>
                  <option value="">Select...</option>
                  <option value="Petrol">Petrol</option>
                  <option value="Diesel">Diesel</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Electric">Electric</option>
                  <option value="Plug-in Hybrid">Plug-in Hybrid</option>
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Engine</span>
                <input value={form.engine} onChange={(e) => updateField("engine", e.target.value)}
                  placeholder="e.g. 4.0L V8, 2.0T" className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Grade / Trim</span>
                <input value={form.grade} onChange={(e) => updateField("grade", e.target.value)}
                  placeholder="e.g. GXR, Limited, Sport, VXR" className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Doors</span>
                <select value={form.doors} onChange={(e) => updateField("doors", e.target.value)} className={inputCls}>
                  <option value="">Select...</option>
                  {["2","3","4","5"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Seats</span>
                <select value={form.seats} onChange={(e) => updateField("seats", e.target.value)} className={inputCls}>
                  <option value="">Select...</option>
                  {["2","4","5","6","7","8","9"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>

              {/* ── CONDITION ── */}
              {sectionHeader("Condition & Features")}

              <label className={labelCls}>
                <span className="font-semibold">Condition</span>
                <select value={form.condition} onChange={(e) => updateField("condition", e.target.value)} className={inputCls}>
                  <option value="">Select...</option>
                  <option value="Brand New">Brand New</option>
                  <option value="Used">Used</option>
                </select>
              </label>

              <label className={`${labelCls} sm:col-span-2`}>
                <span className="font-semibold">Body Issues (optional)</span>
                <textarea value={form.bodyIssues} onChange={(e) => updateField("bodyIssues", e.target.value)}
                  placeholder="e.g. Repainted hood, small dent on driver door, scratched rear bumper"
                  rows={2}
                  className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className={`${labelCls} sm:col-span-2`}>
                <span className="font-semibold">Features (comma-separated)</span>
                <input value={form.features} onChange={(e) => updateField("features", e.target.value)}
                  placeholder="e.g. Sunroof, Leather seats, Android Auto, 360 Camera"
                  className={inputCls} />
              </label>

              {/* ── PRICING & FINANCIALS ── */}
              {!isSupplier && sectionHeader("Purchase & Financials", "Included in financial reports")}
              {isSupplier && sectionHeader("Listing Price", "For display purposes — not tracked in financial reports")}

              <label className={labelCls}>
                <span className="font-semibold">Purchase Price</span>
                <input type="number" value={form.purchasePrice} onChange={(e) => updateField("purchasePrice", e.target.value)}
                  placeholder="e.g. 125000" className={inputCls} />
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Currency</span>
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
                  <span className="font-semibold">Rate <span className="text-[var(--color-accent)]">*</span></span>
                  <input type="number" value={form.purchaseRate} onChange={(e) => updateField("purchaseRate", e.target.value)}
                    placeholder="DZD per AED" className={inputCls} />
                </label>
              ) : <div className="hidden sm:block" />}

              {!isSupplier && (
                <>
                  <label className={labelCls}>
                    <span className="font-semibold">Paid to Supplier</span>
                    <input type="number" value={form.amountPaidToSupplier}
                      onChange={(e) => updateField("amountPaidToSupplier", e.target.value)}
                      placeholder="Defaults to purchase price" className={inputCls} />
                  </label>

                  <label className={labelCls}>
                    <span className="font-semibold">Supplier Owed</span>
                    <input type="text" readOnly
                      value={(() => {
                        const p = form.purchasePrice.trim() ? Number(form.purchasePrice) : 0;
                        const paid = form.amountPaidToSupplier.trim() ? Number(form.amountPaidToSupplier) : p;
                        return p > 0 ? formatNumber(Math.max(0, p - paid)) : "-";
                      })()}
                      className="w-full rounded-md border border-app bg-gray-50 px-3 py-2 text-sm text-muted"
                    />
                  </label>

                  {showPaidFromPocket && (
                    <label className={labelCls}>
                      <span className="font-semibold">Paid From Pocket <span className="text-[var(--color-accent)]">*</span></span>
                      <select value={form.paidFromPocket}
                        onChange={(e) => updateField("paidFromPocket", e.target.value as PaidPocket | "")}
                        className={inputCls}>
                        <option value="">Select pocket</option>
                        {(form.purchaseCurrency === "AED" ? AED_POCKETS : form.purchaseCurrency === "DZD" ? DZD_POCKETS : EUR_POCKETS).map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              {/* ── LOCATION & OWNER ── */}
              {sectionHeader("Location & Owner")}

              <label className={labelCls}>
                <span className="font-semibold">Location</span>
                <select value={form.location}
                  onChange={(e) => updateField("location", e.target.value as "Dubai Showroom" | "Algeria Showroom" | "In Transit")}
                  className={inputCls}>
                  <option value="Dubai Showroom">Dubai Showroom</option>
                  <option value="Algeria Showroom">Algeria Showroom</option>
                  <option value="In Transit">In Transit</option>
                </select>
              </label>

              <label className={labelCls}>
                <span className="font-semibold">Owner</span>
                <select value={form.owner} onChange={(e) => updateField("owner", e.target.value as "Axira" | "Client")} className={inputCls}>
                  <option value="Axira">Axira</option>
                  <option value="Client">Client</option>
                </select>
              </label>

              {showClientName && (
                <label className={`${labelCls} sm:col-span-2`}>
                  <span className="font-semibold">Client Name <span className="text-[var(--color-accent)]">*</span></span>
                  <input value={form.clientName} onChange={(e) => updateField("clientName", e.target.value)}
                    placeholder="Client name" className={inputCls} />
                </label>
              )}

              {/* ── LISTING PRICE ── */}
              {sectionHeader("Listing Price")}

              <label className={`${labelCls} sm:col-span-2`}>
                <span className="font-semibold">Sale Price (DZD) <span className="text-gray-400 font-normal text-xs">— shown on public site; leave blank for Prix sur demande</span></span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={form.salePriceDzd}
                  onChange={(e) => updateField("salePriceDzd", e.target.value)}
                  placeholder="e.g. 3500000"
                  className={inputCls}
                />
              </label>

              {/* ── PUBLISHING & STATUS ── */}
              {sectionHeader("Publishing & Status")}

              <div className="sm:col-span-2 flex flex-wrap gap-4 items-center">
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input type="checkbox" checked={form.isPublished}
                    onChange={(e) => updateField("isPublished", e.target.checked)}
                    className="accent-[var(--color-accent)] w-4 h-4" />
                  <span className="font-semibold">Published on public site</span>
                  <span className="text-muted">(visitors can see this car)</span>
                </label>
              </div>

              <label className={labelCls}>
                <span className="font-semibold">Status Override</span>
                <select value={form.statusOverride} onChange={(e) => updateField("statusOverride", e.target.value)} className={inputCls}>
                  <option value="">Auto (follow container + deal)</option>
                  <option value="available">Force: Available</option>
                  <option value="in_transit">Force: In Transit (For Sale)</option>
                  <option value="sold">Force: Sold</option>
                </select>
              </label>

              {/* ── NOTES ── */}
              {sectionHeader("Notes")}

              <div className="sm:col-span-2">
                <label className={labelCls}>
                  <span className="font-semibold">Notes</span>
                  <textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)}
                    placeholder="Internal notes..." rows={3}
                    className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </div>

              {/* ── PHOTOS ── */}
              {sectionHeader("Photos")}

              <div className="sm:col-span-2 space-y-2 text-xs text-app">
                {carPhotos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {carPhotos.map((url, i) => (
                      <div key={url} className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Car photo ${i + 1}`}
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
                    {isUploadingPhoto ? "Uploading..." : carPhotos.length > 0 ? "Add more photos" : "Click to upload photos"}
                  </div>
                </label>
              </div>

            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeModal} disabled={isSaving}
                className="rounded-md border border-app bg-white px-4 py-2 text-sm font-semibold text-app disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={isSaving}
                className="btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
