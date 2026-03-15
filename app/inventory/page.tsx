"use client";

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
};

const BRANDS = [
  "Acura",
  "Alfa Romeo",
  "Aston Martin",
  "Audi",
  "Bentley",
  "BMW",
  "Bugatti",
  "Buick",
  "BYD",
  "Cadillac",
  "Changan",
  "Chery",
  "Chevrolet",
  "Chrysler",
  "Citroën",
  "Dacia",
  "Dodge",
  "Ferrari",
  "Fiat",
  "Ford",
  "Geely",
  "Genesis",
  "GMC",
  "Haval",
  "Honda",
  "Hummer",
  "Hyundai",
  "Infiniti",
  "Isuzu",
  "Jeep",
  "Kia",
  "Lamborghini",
  "Land Rover",
  "Lexus",
  "Lincoln",
  "Maserati",
  "Mazda",
  "McLaren",
  "Mercedes",
  "MG",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Opel",
  "Peugeot",
  "Porsche",
  "Ram",
  "Range Rover",
  "Renault",
  "Rivian",
  "Rolls Royce",
  "Seat",
  "Skoda",
  "Smart",
  "Subaru",
  "Suzuki",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
];

const YEARS = ["2022", "2023", "2024", "2025", "2026"];

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
});

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const c = currency || "";
  return `${formatNumber(v)}${c ? ` ${c}` : ""}`;
}

type FilterTab = "All" | "Dubai" | "Algeria" | "In Transit" | "Sold";

export default function InventoryPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>("All");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCarId, setEditingCarId] = useState<string | null>(null);
  const [form, setForm] = useState<CarFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const showRate = form.purchaseCurrency === "DZD" || form.purchaseCurrency === "USD" || form.purchaseCurrency === "EUR";
  const showClientName = form.owner === "Client";
  const supplierPaidNumeric = form.amountPaidToSupplier.trim()
    ? Number(form.amountPaidToSupplier)
    : 0;
  const showPaidFromPocket =
    supplierPaidNumeric > 0 &&
    (form.purchaseCurrency === "AED" || form.purchaseCurrency === "DZD" || form.purchaseCurrency === "EUR");

  const AED_POCKETS: PaidPocket[] = ["Dubai Cash", "Dubai Bank", "Qatar"];
  const DZD_POCKETS: PaidPocket[] = ["Algeria Cash", "Algeria Bank"];
  const EUR_POCKETS: PaidPocket[] = ["EUR Cash"];

  const fetchCars = async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("cars")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("Failed to load cars.");
      setCars([]);
      setIsLoading(false);
      return;
    }

    setCars((data as Car[]) ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCars = useMemo(() => {
    if (activeTab === "All") return cars;
    if (activeTab === "Sold") return cars.filter((c) => (c.status || "").toLowerCase() === "sold");
    if (activeTab === "Dubai") return cars.filter((c) => c.location === "Dubai Showroom");
    if (activeTab === "Algeria") return cars.filter((c) => c.location === "Algeria Showroom");
    return cars.filter((c) => c.location === "In Transit");
  }, [activeTab, cars]);

  const openAddModal = () => {
    setEditingCarId(null);
    setForm(emptyForm());
    setIsModalOpen(true);
    setError(null);
  };

  const openEditModal = (car: Car) => {
    setEditingCarId(car.id);
    const purchasePrice = car.purchase_price ?? 0;
    const paid = car.supplier_paid ?? purchasePrice;
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
      location:
        (car.location as "Dubai Showroom" | "Algeria Showroom" | "In Transit") || "Dubai Showroom",
      owner: (car.owner as "Axira" | "Client") || "Axira",
      clientName: car.client_name || "",
      notes: car.notes || "",
      status: (car.status as "available" | "sold") || "available",
      amountPaidToSupplier: paid != null ? String(paid) : "",
      paidFromPocket: "",
      countryOfOrigin: car.country_of_origin || "",
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
    if (showPaidFromPocket) {
      if (!form.paidFromPocket) return '"Paid From Pocket" is required when supplier is paid.';
    }
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

    const purchasePriceNum = form.purchasePrice.trim() ? Number(form.purchasePrice) : 0;
    const supplierPaidNum = form.amountPaidToSupplier.trim()
      ? Number(form.amountPaidToSupplier)
      : purchasePriceNum;
    const supplierOwedNum = Math.max(0, purchasePriceNum - supplierPaidNum);

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
      supplier_paid: supplierPaidNum,
      supplier_owed: supplierOwedNum,
      country_of_origin: form.countryOfOrigin || null,
    };

    const carLabel = `${form.brand} ${form.model} ${form.year}`.trim();
    if (editingCarId) {
      const { error: updateError } = await supabase.from("cars").update(payload).eq("id", editingCarId);
      if (updateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase update error:", updateError);
        setError(
          [
            "Failed to update car.",
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
        entity: "car",
        entity_id: editingCarId,
        description: `Car updated – ${carLabel}`,
        amount: payload.purchase_price ?? undefined,
        currency: payload.purchase_currency ?? undefined,
      });
    } else {
      const { data: inserted, error: insertError } = await supabase.from("cars").insert(payload).select("id").single();
      if (insertError) {
        // eslint-disable-next-line no-console
        console.log("Supabase insert error:", insertError);
        setError(
          [
            "Failed to add car.",
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
      const newCarId = (inserted as { id: string } | null)?.id;
      if (newCarId) {
        await logActivity({
          action: "created",
          entity: "car",
          entity_id: newCarId,
          description: `Car added – ${carLabel}`,
          amount: payload.purchase_price ?? undefined,
          currency: payload.purchase_currency ?? undefined,
        });
        // Telegram notification — new car
        fetch("/api/telegram/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "new_car",
            data: {
              brand: payload.brand ?? "",
              model: payload.model ?? "",
              year: payload.year,
              color: payload.color,
            },
          }),
        }).catch(() => {});
      }

      if (
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
          aed_equivalent:
            form.purchaseCurrency === "AED" || form.purchaseCurrency === "EUR" ? supplierPaidNum : null,
          pocket: form.paidFromPocket,
          deal_id: null,
          payment_id: null,
          reference: null,
        };

        const { error: movementError } = await supabase
          .from("movements")
          .insert(movementPayload);

        if (movementError) {
          // eslint-disable-next-line no-console
          console.log("Supabase car purchase movement error:", movementError);
          setError(
            [
              "Car saved, but failed to create purchase movement.",
              movementError.message,
              movementError.details,
              movementError.hint,
            ]
              .filter(Boolean)
              .join(" ")
          );
        }

        const { data: pocketRow, error: pocketError } = await supabase
          .from("cash_positions")
          .select("id, amount")
          .eq("pocket", form.paidFromPocket)
          .eq("currency", form.purchaseCurrency)
          .maybeSingle();

        if (!pocketError && pocketRow) {
          const currentAmount = (pocketRow as { amount?: number }).amount || 0;
          const { error: updatePocketError } = await supabase
            .from("cash_positions")
            .update({ amount: currentAmount - supplierPaidNum })
            .eq("id", (pocketRow as { id: string }).id);

          if (updatePocketError) {
            // eslint-disable-next-line no-console
            console.log(
              "Supabase update cash position for car purchase error:",
              updatePocketError
            );
            setError(
              [
                "Car saved, but failed to update cash position.",
                updatePocketError.message,
                updatePocketError.details,
                updatePocketError.hint,
              ]
                .filter(Boolean)
                .join(" ")
            );
          }
        } else if (pocketError) {
          // eslint-disable-next-line no-console
          console.log(
            "Supabase fetch cash position for car purchase error:",
            pocketError
          );
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

    const { data: dealRows } = await supabase
      .from("deals")
      .select("id")
      .eq("car_id", car.id)
      .limit(1);
    if (dealRows && dealRows.length > 0) {
      setError("Cannot delete car with an active deal. Delete the deal first.");
      setIsDeletingId(null);
      return;
    }

    const { data: containerCarRows } = await supabase
      .from("container_cars")
      .select("id")
      .eq("car_id", car.id)
      .limit(1);
    if (containerCarRows && containerCarRows.length > 0) {
      setError("Cannot delete car inside a container. Remove from container first.");
      setIsDeletingId(null);
      return;
    }

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
          const newAmount = current + amount;
          await supabase
            .from("cash_positions")
            .update({ amount: newAmount })
            .eq("id", (pos as { id: string }).id);
        }
        await supabase.from("movements").delete().eq("id", (movement as { id: string }).id);
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
      amount: car.purchase_price ?? undefined,
      currency: car.purchase_currency ?? undefined,
    });
    setCars((prev) => prev.filter((c) => c.id !== car.id));
    setIsDeletingId(null);
  };

  const filterTabLabels: Record<FilterTab, string> = {
    All: "All",
    Dubai: "Dubai",
    Algeria: "Algeria",
    "In Transit": "In Transit",
    Sold: "Sold",
  };

  return (
    <div className="min-h-screen bg-app text-app">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Inventory</h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">Cars</p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="btn-primary inline-flex items-center justify-center px-4 py-2 text-sm font-semibold"
          >
            Add Car
          </button>
        </header>

        <div className="flex flex-wrap gap-2">
          {(["All", "Dubai", "Algeria", "In Transit", "Sold"] as FilterTab[]).map((tab) => (
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
              {filterTabLabels[tab]}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-app surface px-3 py-2 text-xs text-app">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-app surface">
          {isLoading ? (
            <div className="p-4 text-sm text-muted">Loading cars...</div>
          ) : filteredCars.length === 0 ? (
            <div className="p-4 text-sm text-muted">No cars found.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[1100px] w-full text-left text-xs rtl:text-right">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Car</th>
                    <th className="px-4 py-3">Color</th>
                    <th className="px-4 py-3">Mileage</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Purchase Price</th>
                    <th className="px-4 py-3">Paid to Supplier</th>
                    <th className="px-4 py-3">Supplier Owed</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCars.map((car) => {
                    const carTitle = `${car.brand || ""} ${car.model || ""} ${car.year || ""}`.trim();
                    const status = (car.status || "available").toLowerCase();
                    return (
                      <tr key={car.id} className="border-b border-app last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-app">{carTitle || "Car"}</div>
                          {car.vin ? <div className="mt-0.5 text-[11px] text-muted">VIN: {car.vin}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-app">{car.color || "-"}</td>
                        <td className="px-4 py-3 text-app">
                          {car.mileage != null ? formatNumber(car.mileage) : "-"}
                        </td>
                        <td className="px-4 py-3 text-app">{car.location || "-"}</td>
                        <td className="px-4 py-3 text-app">
                          {car.owner || "-"}
                          {car.owner === "Client" && car.client_name ? (
                            <div className="mt-0.5 text-[11px] text-muted">{car.client_name}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {formatMoney(car.purchase_price, car.purchase_currency)}
                          {car.purchase_rate != null ? (
                            <div className="mt-0.5 text-[11px] text-muted">Rate: {formatNumber(car.purchase_rate)}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {car.supplier_paid != null ? formatNumber(car.supplier_paid) : "-"}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {car.supplier_owed != null && car.supplier_owed > 0
                            ? formatNumber(car.supplier_owed)
                            : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={[
                              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              status === "sold"
                                ? "border-app bg-black text-app"
                                : "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-app",
                            ].join(" ")}
                          >
                            {status === "sold" ? "Sold" : "Available"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(car)}
                              className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)]/70"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(car)}
                              disabled={isDeletingId === car.id}
                              className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-red-700 disabled:opacity-50"
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

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative w-full max-w-2xl rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  {editingCarId ? "Edit Car" : "Add Car"}
                </div>
                <div className="text-xs text-muted">
                  Fields marked mandatory should be filled.
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

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Brand</span>
                <select
                  value={form.brand}
                  onChange={(e) => updateField("brand", e.target.value)}
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {BRANDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Model</span>
                <input
                  value={form.model}
                  onChange={(e) => updateField("model", e.target.value)}
                  placeholder="e.g. Prado"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Year</span>
                <select
                  value={form.year}
                  onChange={(e) => updateField("year", e.target.value)}
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">
                  Color <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input
                  value={form.color}
                  onChange={(e) => updateField("color", e.target.value)}
                  placeholder="e.g. White"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">
                  Mileage <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input
                  type="number"
                  value={form.mileage}
                  onChange={(e) => updateField("mileage", e.target.value)}
                  placeholder="e.g. 54000"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">VIN (optional)</span>
                <input
                  value={form.vin}
                  onChange={(e) => updateField("vin", e.target.value)}
                  placeholder="VIN"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Country of Origin (optional)</span>
                <input
                  value={form.countryOfOrigin}
                  onChange={(e) => updateField("countryOfOrigin", e.target.value)}
                  placeholder="e.g. China, Japan, Korea"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Purchase Price</span>
                <input
                  type="number"
                  value={form.purchasePrice}
                  onChange={(e) => updateField("purchasePrice", e.target.value)}
                  placeholder="e.g. 125000"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Amount Paid to Supplier</span>
                <input
                  type="number"
                  value={form.amountPaidToSupplier}
                  onChange={(e) => updateField("amountPaidToSupplier", e.target.value)}
                  placeholder="Defaults to purchase price (fully paid)"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Supplier Owed</span>
                <input
                  type="text"
                  readOnly
                  value={(() => {
                    const p = form.purchasePrice.trim() ? Number(form.purchasePrice) : 0;
                    const paid = form.amountPaidToSupplier.trim() ? Number(form.amountPaidToSupplier) : p;
                    const owed = Math.max(0, p - paid);
                    return p > 0 ? formatNumber(owed) : "-";
                  })()}
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-muted"
                />
              </label>

              {showPaidFromPocket && (
                <label className="space-y-1 text-xs text-app">
                  <span className="font-semibold">
                    Paid From Pocket <span className="text-[var(--color-accent)]">*</span>
                  </span>
                  <select
                    value={form.paidFromPocket}
                    onChange={(e) =>
                      updateField(
                        "paidFromPocket",
                        e.target.value as PaidPocket | ""
                      )
                    }
                    className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="">Select pocket</option>
                    {(form.purchaseCurrency === "AED"
                      ? AED_POCKETS
                      : form.purchaseCurrency === "DZD"
                      ? DZD_POCKETS
                      : form.purchaseCurrency === "EUR"
                      ? EUR_POCKETS
                      : []
                    ).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Purchase Currency</span>
                <select
                  value={form.purchaseCurrency}
                  onChange={(e) =>
                    updateField("purchaseCurrency", e.target.value as "AED" | "DZD" | "USD" | "EUR")
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="AED">AED</option>
                  <option value="DZD">DZD</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              {showRate ? (
                <label className="space-y-1 text-xs text-app">
                  <span className="font-semibold">
                    Purchase Rate <span className="text-[var(--color-accent)]">*</span>
                  </span>
                  <input
                    type="number"
                    value={form.purchaseRate}
                    onChange={(e) => updateField("purchaseRate", e.target.value)}
                    placeholder="e.g. 1.00"
                    className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              ) : (
                <div className="hidden sm:block" />
              )}

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Location</span>
                <select
                  value={form.location}
                  onChange={(e) =>
                    updateField(
                      "location",
                      e.target.value as "Dubai Showroom" | "Algeria Showroom" | "In Transit"
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="Dubai Showroom">Dubai Showroom</option>
                  <option value="Algeria Showroom">Algeria Showroom</option>
                  <option value="In Transit">In Transit</option>
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Owner</span>
                <select
                  value={form.owner}
                  onChange={(e) => updateField("owner", e.target.value as "Axira" | "Client")}
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="Axira">Axira</option>
                  <option value="Client">Client</option>
                </select>
              </label>

              {showClientName ? (
                <label className="space-y-1 text-xs text-app sm:col-span-2">
                  <span className="font-semibold">
                    Client Name <span className="text-[var(--color-accent)]">*</span>
                  </span>
                  <input
                    value={form.clientName}
                    onChange={(e) => updateField("clientName", e.target.value)}
                    placeholder="Client name"
                    className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              ) : null}

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Status</span>
                <select
                  value={form.status}
                  onChange={(e) => updateField("status", e.target.value as "available" | "sold")}
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="available">available</option>
                  <option value="sold">sold</option>
                </select>
              </label>

              <div className="sm:col-span-2">
                <label className="space-y-1 text-xs text-app">
                  <span className="font-semibold">Notes</span>
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    placeholder="Notes..."
                    rows={4}
                    className="w-full resize-none rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </div>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
                className="btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

