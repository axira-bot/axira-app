"use client";

import { useEffect, useMemo, useState } from "react";
import type { Car, Deal } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

type Container = {
  id: string;
  ref: string | null;
  date: string | null;
  shipping_cost: number | null;
  shipping_paid: boolean | null;
  invoice_ref: string | null;
  status: "Loading" | "In Transit" | "Arrived" | "Cleared" | string | null;
  notes: string | null;
  drive_link: string | null;
  created_at?: string | null;
};

type ContainerCar = {
  id: string;
  container_id: string;
  car_id: string | null;
  car_label: string | null;
  is_partner: boolean | null;
  partner_name: string | null;
  shipping_contribution: number | null;
  customs_status: string | null;
  customs_paid_dzd: number | null;
};

type NewContainerForm = {
  ref: string;
  date: string;
  estimatedShipping: string;
  invoiceRef: string;
  status: "Loading" | "In Transit" | "Arrived" | "Cleared";
  notes: string;
  driveLink: string;
};

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

type AddCarForm = {
  mode: "inventory" | "manual";
  inventoryCarId: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  isPartner: boolean;
  partnerName: string;
  shippingContribution: string;
};

type PayInvoiceForm = {
  amount: string;
  pocket: "Dubai Cash" | "Dubai Bank" | "Qatar" | "Algeria Cash" | "Algeria Bank";
};

const STATUS_OPTIONS: Array<NewContainerForm["status"]> = [
  "Loading",
  "In Transit",
  "Arrived",
  "Cleared",
];

const STATUS_BADGE: Record<string, string> = {
  Loading: "bg-amber-50 text-amber-700 border-amber-300",
  "In Transit": "bg-sky-50 text-sky-700 border-sky-300",
  Arrived: "bg-orange-50 text-orange-700 border-orange-300",
  Cleared: "bg-emerald-50 text-emerald-700 border-emerald-300",
};

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

export default function ContainersPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [containers, setContainers] = useState<Container[]>([]);
  const [containerCars, setContainerCars] = useState<ContainerCar[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newForm, setNewForm] = useState<NewContainerForm>({
    ref: "",
    date: new Date().toISOString().slice(0, 10),
    estimatedShipping: "",
    invoiceRef: "",
    status: "Loading",
    notes: "",
    driveLink: "",
  });
  const [isSavingNew, setIsSavingNew] = useState(false);
  const [editingContainerId, setEditingContainerId] = useState<string | null>(
    null
  );

  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null
  );
  const [addCarForm, setAddCarForm] = useState<AddCarForm>({
    mode: "inventory",
    inventoryCarId: "",
    brand: "",
    model: "",
    year: "",
    color: "",
    isPartner: false,
    partnerName: "",
    shippingContribution: "",
  });
  const [isAddingCar, setIsAddingCar] = useState(false);

  const [payInvoiceForm, setPayInvoiceForm] = useState<PayInvoiceForm>({
    amount: "",
    pocket: "Dubai Cash",
  });
  const [isPayingInvoice, setIsPayingInvoice] = useState(false);

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);

    const [
      { data: containersData, error: containersError },
      { data: containerCarsData, error: containerCarsError },
      { data: carsData, error: carsError },
      { data: dealsData, error: dealsError },
    ] = await Promise.all([
      supabase
        .from("containers")
        .select("*")
        .order("date", { ascending: false }),
      supabase.from("container_cars").select("*"),
      supabase
        .from("cars")
        .select("id, brand, model, year, color, location, owner, client_name"),
      supabase
        .from("deals")
        .select(
          "id, car_id, car_label, cost_shipping, profit, total_expenses, sale_aed"
        ),
    ]);

    if (containersError || containerCarsError || carsError || dealsError) {
      setError(
        [
          "Failed to load containers data.",
          containersError?.message,
          containerCarsError?.message,
          carsError?.message,
          dealsError?.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    setContainers((containersData as Container[]) ?? []);
    setContainerCars((containerCarsData as ContainerCar[]) ?? []);
    setCars((carsData as Car[]) ?? []);
    setDeals((dealsData as Deal[]) ?? []);

    setIsLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateNewField = <K extends keyof NewContainerForm>(
    key: K,
    value: NewContainerForm[K]
  ) => {
    setNewForm((prev) => ({ ...prev, [key]: value }));
  };

  const validateNewContainer = () => {
    if (!newForm.ref.trim()) return "Reference is required.";
    if (!newForm.date) return "Date is required.";
    return null;
  };

  const handleCreateContainer = async () => {
    const msg = validateNewContainer();
    if (msg) {
      setError(msg);
      return;
    }
    setIsSavingNew(true);
    setError(null);

    const estimated = parseNum(newForm.estimatedShipping);

    if (editingContainerId) {
      const { error: updateError } = await supabase
        .from("containers")
        .update({
          ref: newForm.ref.trim(),
          date: newForm.date,
          shipping_cost: estimated || null,
          invoice_ref: newForm.invoiceRef || null,
          status: newForm.status,
          notes: newForm.notes || null,
          drive_link: newForm.driveLink.trim() || null,
        })
        .eq("id", editingContainerId);

      if (updateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase update container error:", updateError);
        setError(
          [
            "Failed to update container.",
            updateError.message,
            updateError.details,
            updateError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
        setIsSavingNew(false);
        return;
      }
      await logActivity({
        action: "updated",
        entity: "container",
        entity_id: editingContainerId,
        description: `Container updated – ${newForm.ref.trim() || editingContainerId}`,
      });

      // Sync car display_status when container status changes
      const newContainerStatus = newForm.status;
      if (
        newContainerStatus === "In Transit" ||
        newContainerStatus === "Arrived" ||
        newContainerStatus === "Cleared"
      ) {
        const { data: containerCarsList } = await supabase
          .from("container_cars")
          .select("car_id")
          .eq("container_id", editingContainerId)
          .not("car_id", "is", null);

        const carIds = ((containerCarsList ?? []) as { car_id: string | null }[])
          .map((cc) => cc.car_id)
          .filter(Boolean) as string[];

        if (carIds.length > 0) {
          // Only update cars that are not already sold and have no manual override
          const { data: eligibleCars } = await supabase
            .from("cars")
            .select("id")
            .in("id", carIds)
            .neq("status", "sold")
            .is("status_override", null);

          const eligibleIds = ((eligibleCars ?? []) as { id: string }[]).map((c) => c.id);

          if (eligibleIds.length > 0) {
            const newDisplayStatus =
              newContainerStatus === "In Transit" ? "in_transit" : "available";
            await supabase
              .from("cars")
              .update({ display_status: newDisplayStatus })
              .in("id", eligibleIds);
          }
        }
      }
    } else {
      const { data: inserted, error: insertError } = await supabase.from("containers").insert({
        ref: newForm.ref.trim(),
        date: newForm.date,
        shipping_cost: estimated || null,
        shipping_paid: false,
        invoice_ref: newForm.invoiceRef || null,
        status: newForm.status,
        notes: newForm.notes || null,
        drive_link: newForm.driveLink.trim() || null,
      }).select("id").single();

      if (insertError) {
        // eslint-disable-next-line no-console
        console.log("Supabase insert container error:", insertError);
        setError(
          [
            "Failed to create container.",
            insertError.message,
            insertError.details,
            insertError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
        setIsSavingNew(false);
        return;
      }
      const newId = (inserted as { id: string } | null)?.id;
      if (newId) {
        await logActivity({
          action: "created",
          entity: "container",
          entity_id: newId,
          description: `Container created – ${newForm.ref.trim() || "—"}`,
        });
      }
    }

    setIsSavingNew(false);
    setIsNewModalOpen(false);
    setEditingContainerId(null);
    setNewForm({
      ref: "",
      date: new Date().toISOString().slice(0, 10),
      estimatedShipping: "",
      invoiceRef: "",
      status: "Loading",
      notes: "",
      driveLink: "",
    });
    await fetchAll();
  };

  const handleDeleteContainer = async (container: Container) => {
    const carsInContainer = containerCars.filter((cc) => cc.container_id === container.id);
    if (carsInContainer.length > 0) {
      setError("Remove all cars from container before deleting.");
      return;
    }

    if (
      !window.confirm(
        `Delete container ${container.ref || container.id}? This cannot be undone.`
      )
    )
      return;

    setError(null);

    if (container.shipping_paid && (container.shipping_cost ?? 0) > 0) {
      const containerRefStr = container.ref || container.id;
      const { data: shippingMovements } = await supabase
        .from("movements")
        .select("id, type, amount, currency, pocket")
        .eq("category", "Shipping")
        .ilike("description", `%${containerRefStr}%`)
        .limit(1);
      const movement = shippingMovements?.[0];
      if (movement) {
        const m = movement as { id: string; pocket?: string; currency?: string; amount?: number };
        const pocket = m.pocket ?? "";
        const currency = (m.currency || "AED").trim() || "AED";
        const amount = m.amount ?? 0;
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
          await supabase.from("movements").delete().eq("id", m.id);
        }
      }
    }

    const { error: deleteError } = await supabase
      .from("containers")
      .delete()
      .eq("id", container.id);

    if (deleteError) {
      // eslint-disable-next-line no-console
      console.log("Supabase delete container error:", deleteError);
      setError(
        [
          "Failed to delete container.",
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
      entity: "container",
      entity_id: container.id,
      description: `Container deleted – ${container.ref || container.id}`,
    });
    setContainers((prev) => prev.filter((c) => c.id !== container.id));
    if (selectedContainerId === container.id) {
      setSelectedContainerId(null);
    }
  };

  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selectedContainerId) || null,
    [containers, selectedContainerId]
  );

  const carsInContainer = useMemo(
    () =>
      containerCars.filter((cc) => cc.container_id === selectedContainerId),
    [containerCars, selectedContainerId]
  );

  const availableInventoryCars = useMemo(() => {
    // cars not already in a container and ideally in Dubai/Algeria showrooms
    const usedCarIds = new Set(
      containerCars.map((cc) => cc.car_id).filter(Boolean) as string[]
    );
    return cars.filter((c) => !usedCarIds.has(c.id));
  }, [cars, containerCars]);

  const totalCarsInContainer = carsInContainer.length;

  const updateAddCarField = <K extends keyof AddCarForm>(
    key: K,
    value: AddCarForm[K]
  ) => {
    setAddCarForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddCar = async () => {
    if (!selectedContainer) return;

    setIsAddingCar(true);
    setError(null);

    let carId: string | null = null;
    let carLabel: string | null = null;

    if (addCarForm.mode === "inventory") {
      const car = cars.find((c) => c.id === addCarForm.inventoryCarId);
      if (!car) {
        setError("Select a car from inventory or switch to manual mode.");
        setIsAddingCar(false);
        return;
      }
      carId = car.id;
      carLabel = `${car.brand || ""} ${car.model || ""} ${
        car.year || ""
      }`.trim();
    } else {
      if (!addCarForm.brand.trim() || !addCarForm.model.trim()) {
        setError("Brand and Model are required for manual cars.");
        setIsAddingCar(false);
        return;
      }
      const label = `${addCarForm.brand} ${addCarForm.model} ${
        addCarForm.year || ""
      }`.trim();
      carId = null;
      carLabel = label;
    }

    const shippingContribution = addCarForm.shippingContribution.trim()
      ? parseNum(addCarForm.shippingContribution)
      : null;

    const { data: inserted, error: insertError } = await supabase
      .from("container_cars")
      .insert({
        container_id: selectedContainer.id,
        car_id: carId,
        car_label: carLabel,
        is_partner: addCarForm.isPartner,
        partner_name: addCarForm.isPartner
          ? addCarForm.partnerName || null
          : null,
        shipping_contribution: shippingContribution,
        customs_status: "pending",
        customs_paid_dzd: null,
      })
      .select("*")
      .single();

    if (insertError) {
      // eslint-disable-next-line no-console
      console.log("Supabase insert container_cars error:", insertError);
      setError(
        [
          "Failed to add car to container.",
          insertError.message,
          insertError.details,
          insertError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
      setIsAddingCar(false);
      return;
    }
    await logActivity({
      action: "created",
      entity: "container",
      entity_id: selectedContainer.id,
      description: `Car added to container – ${selectedContainer.ref || selectedContainer.id} – ${carLabel || "car"}`,
    });

    // If inventory car, update its location to In Transit
    if (carId) {
      const { error: carUpdateError } = await supabase
        .from("cars")
        .update({ location: "In Transit" })
        .eq("id", carId);
      if (carUpdateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase update car location error:", carUpdateError);
      } else {
        setCars((prev) =>
          prev.map((c) =>
            c.id === carId ? { ...c, location: "In Transit" } : c
          )
        );
      }
    }

    setContainerCars((prev) => [
      ...prev,
      inserted as unknown as ContainerCar,
    ]);

    setAddCarForm({
      mode: "inventory",
      inventoryCarId: "",
      brand: "",
      model: "",
      year: "",
      color: "",
      isPartner: false,
      partnerName: "",
      shippingContribution: "",
    });
    setIsAddingCar(false);
  };

  const handleRemoveCar = async (cc: ContainerCar) => {
    if (!window.confirm("Remove this car from container?")) return;

    setError(null);
    const { error: deleteError } = await supabase
      .from("container_cars")
      .delete()
      .eq("id", cc.id);

    if (deleteError) {
      // eslint-disable-next-line no-console
      console.log("Supabase delete container_car error:", deleteError);
      setError(
        [
          "Failed to remove car from container.",
          deleteError.message,
          deleteError.details,
          deleteError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
      return;
    }

    setContainerCars((prev) => prev.filter((x) => x.id !== cc.id));
  };

  const updatePayInvoiceField = <K extends keyof PayInvoiceForm>(
    key: K,
    value: PayInvoiceForm[K]
  ) => {
    setPayInvoiceForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePayInvoice = async () => {
    if (!selectedContainer) return;
    if (selectedContainer.shipping_paid) return;
    const amount = parseNum(payInvoiceForm.amount);
    if (amount <= 0) {
      setError("Invoice amount must be greater than 0.");
      return;
    }
    if (carsInContainer.length === 0) {
      setError("No cars in container to split shipping cost.");
      return;
    }

    setIsPayingInvoice(true);
    setError(null);

    const currency = (payInvoiceForm.pocket === "Algeria Cash" || payInvoiceForm.pocket === "Algeria Bank") ? "DZD" : "AED";

    // 1. Update container with actual shipping cost and mark as paid
    const invoiceRef =
      selectedContainer.invoice_ref ||
      `INV-${selectedContainer.ref || selectedContainer.id}-${new Date()
        .toISOString()
        .slice(0, 10)}-${amount}`;

    const { error: containerUpdateError } = await supabase
      .from("containers")
      .update({
        shipping_cost: amount,
        shipping_paid: true,
        invoice_ref: invoiceRef,
      })
      .eq("id", selectedContainer.id);

    if (containerUpdateError) {
      // eslint-disable-next-line no-console
      console.log("Supabase update container error:", containerUpdateError);
      setError(
        [
          "Failed to update container with invoice.",
          containerUpdateError.message,
          containerUpdateError.details,
          containerUpdateError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
      setIsPayingInvoice(false);
      return;
    }
    await logActivity({
      action: "paid",
      entity: "container",
      entity_id: selectedContainer.id,
      description: `Invoice paid – ${selectedContainer.ref || selectedContainer.id}`,
      amount,
      currency,
    });

    // Update local state immediately so "Invoice Paid" button state persists and cannot be clicked again
    setContainers((prev) =>
      prev.map((c) =>
        c.id === selectedContainer.id
          ? {
              ...c,
              shipping_cost: amount,
              shipping_paid: true,
              invoice_ref: invoiceRef,
            }
          : c
      )
    );

    const containerRefStr = selectedContainer.ref || selectedContainer.id;
    const movementDescription = `Container ${containerRefStr} invoice`;

    // 2. Create movement only if one does not already exist for this container
    const { data: existingMovements } = await supabase
      .from("movements")
      .select("id")
      .eq("category", "Shipping")
      .ilike("description", `%${containerRefStr}%`)
      .limit(1);

    if (!existingMovements || existingMovements.length === 0) {
      const { error: movementError } = await supabase.from("movements").insert({
        date: new Date().toISOString().slice(0, 10),
        type: "Out",
        category: "Shipping",
        description: movementDescription,
        amount,
        currency: "AED",
        rate: 1,
        aed_equivalent: amount,
        pocket: payInvoiceForm.pocket,
        deal_id: null,
        payment_id: null,
        reference: invoiceRef,
      });

      if (movementError) {
        // eslint-disable-next-line no-console
        console.log("Supabase shipping movement error:", movementError);
        setError(
          [
            "Invoice saved, but failed to create shipping movement.",
            movementError.message,
            movementError.details,
            movementError.hint,
          ]
            .filter(Boolean)
          .join(" ")
        );
      }
    }

    // 2b. Always deduct invoice amount from selected pocket (cash_positions)
    const { data: pocketRow } = await supabase
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", payInvoiceForm.pocket)
      .eq("currency", "AED")
      .limit(1)
      .maybeSingle();
    if (pocketRow) {
      const currentAmount = (pocketRow as { amount?: number }).amount ?? 0;
      await supabase
        .from("cash_positions")
        .update({ amount: currentAmount - amount })
        .eq("id", (pocketRow as { id: string }).id);
    }

    // 3. Split cost across cars and update deals.cost_shipping & profit
    // Log which container_cars we're about to process
    // eslint-disable-next-line no-console
    console.log(
      "Splitting shipping for container cars:",
      carsInContainer.map((cc) => ({
        id: cc.id,
        car_id: cc.car_id,
        shipping_contribution: cc.shipping_contribution,
        is_partner: cc.is_partner,
      }))
    );
    const perCarDefault = amount / carsInContainer.length;

    const updatedDealsSummary: { id: string; profit: number }[] = [];

    for (const cc of carsInContainer) {
      if (!cc.car_id) continue;

      const contribution =
        cc.shipping_contribution != null
          ? cc.shipping_contribution
          : perCarDefault;

      // Log each car_id we're processing
      // eslint-disable-next-line no-console
      console.log(
        "Processing container_car for shipping split:",
        cc.id,
        "car_id=",
        cc.car_id,
        "contribution=",
        contribution
      );

      // 1) Fetch current deal for this car_id from Supabase
      const {
        data: dealRow,
        error: dealFetchError,
      } = await supabase
        .from("deals")
        .select(
          "id, cost_car, cost_shipping, cost_inspection, cost_recovery, cost_maintenance, cost_other, sale_aed"
        )
        .eq("car_id", cc.car_id)
        .maybeSingle();

      if (dealFetchError || !dealRow) {
        // eslint-disable-next-line no-console
        console.log(
          "Supabase fetch deal for shipping split error:",
          dealFetchError
        );
        continue;
      }

      // Log the fetched deal before calculations
      // eslint-disable-next-line no-console
      console.log("Fetched deal for car_id", cc.car_id, "=>", dealRow);

      const currentCostCar = dealRow.cost_car || 0;
      const currentCostInspection = dealRow.cost_inspection || 0;
      const currentCostRecovery = dealRow.cost_recovery || 0;
      const currentCostMaintenance = dealRow.cost_maintenance || 0;
      const currentCostOther = dealRow.cost_other || 0;
      const saleAed = dealRow.sale_aed || 0;

      // 2) New cost_shipping is the split amount
      const newCostShipping = contribution;

      // 3) Recalculate total_expenses using freshly fetched costs
      const totalExpenses =
        currentCostCar +
        newCostShipping +
        currentCostInspection +
        currentCostRecovery +
        currentCostMaintenance +
        currentCostOther;

      // 4) Recalculate profit
      const profit = saleAed - totalExpenses;

      // Log the calculation details
      // eslint-disable-next-line no-console
      console.log(
        "Shipping split calculation for deal",
        dealRow.id,
        {
          cost_car: currentCostCar,
          new_cost_shipping: newCostShipping,
          cost_inspection: currentCostInspection,
          cost_recovery: currentCostRecovery,
          cost_maintenance: currentCostMaintenance,
          cost_other: currentCostOther,
          total_expenses: totalExpenses,
          sale_aed: saleAed,
          profit,
        }
      );

      const { error: dealUpdateError } = await supabase
        .from("deals")
        .update({
          cost_shipping: newCostShipping,
          total_expenses: totalExpenses,
          profit,
        })
        .eq("id", dealRow.id);

      if (dealUpdateError) {
        // eslint-disable-next-line no-console
        console.log("Supabase update deal shipping error:", dealUpdateError);
        setError(
          [
            "Invoice saved, but failed to update some deal shipping costs.",
            dealUpdateError.message,
            dealUpdateError.details,
            dealUpdateError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
      } else {
        // Log successful update
        // eslint-disable-next-line no-console
        console.log(
          "Updated deal shipping successfully:",
          dealRow.id,
          "profit:",
          profit
        );
        updatedDealsSummary.push({ id: dealRow.id, profit });
        setDeals((prev) =>
          prev.map((d) =>
            d.id === dealRow.id
              ? {
                  ...d,
                  cost_shipping: newCostShipping,
                  total_expenses: totalExpenses,
                  profit,
                }
              : d
          )
        );
      }

      // Partner cars: partner pays Axira = movement IN
      if (cc.is_partner && contribution > 0) {
        const { error: partnerMoveError } = await supabase
          .from("movements")
          .insert({
            date: new Date().toISOString().slice(0, 10),
            type: "In",
            category: "Shipping",
            description: `Partner shipping contribution for ${
              cc.partner_name || "partner"
            }`,
            amount: contribution,
            currency: "AED",
            rate: 1,
            aed_equivalent: contribution,
            pocket: "Dubai Cash",
            deal_id: dealRow.id,
            payment_id: null,
            reference: invoiceRef,
          });
        if (partnerMoveError) {
          // eslint-disable-next-line no-console
          console.log(
            "Supabase partner shipping movement error:",
            partnerMoveError
          );
        }
      }
    }

    // Log which deals were updated and their new profits
    if (updatedDealsSummary.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "Updated deals after shipping split:",
        updatedDealsSummary.map((d) => `deal_id=${d.id}, profit=${d.profit}`)
      );
    }

    setContainers((prev) =>
      prev.map((c) =>
        c.id === selectedContainer.id
          ? {
              ...c,
              shipping_cost: amount,
              shipping_paid: true,
              invoice_ref: invoiceRef,
            }
          : c
      )
    );
    setIsPayingInvoice(false);
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Containers
            </h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">
              Shipping & logistics
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingContainerId(null);
              setNewForm({
                ref: "",
                date: new Date().toISOString().slice(0, 10),
                estimatedShipping: "",
                invoiceRef: "",
                status: "Loading",
                notes: "",
                driveLink: "",
              });
              setIsNewModalOpen(true);
              setError(null);
            }}
            className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            New Container
          </button>
        </header>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Containers list */}
        <div className="rounded-lg border border-app surface">
          {isLoading ? (
            <div className="p-4 text-sm text-muted">Loading containers...</div>
          ) : containers.length === 0 ? (
            <div className="p-4 text-sm text-muted">No containers yet.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[640px] w-full text-left text-xs">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Cars</th>
                    <th className="px-4 py-3">Estimated</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Actual</th>
                    <th className="px-4 py-3 w-10">Drive</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((container) => {
                    const carsCount = containerCars.filter(
                      (cc) => cc.container_id === container.id
                    ).length;
                    const status = container.status || "Loading";
                    const badgeClass =
                      STATUS_BADGE[status] ||
                      "bg-zinc-900/40 text-app border-zinc-600/40";
                    return (
                      <tr
                        key={container.id}
                        className="border-b border-app last:border-b-0"
                      >
                        <td className="px-4 py-3 font-semibold text-app">
                          {container.ref || container.id}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {formatDate(container.date ?? container.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">{carsCount}</td>
                        <td className="px-4 py-3 text-app">
                          {formatMoney(container.shipping_cost, "AED")}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">
                          {container.shipping_paid
                            ? formatMoney(container.shipping_cost, "AED")
                            : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <DriveLinkIcon href={container.drive_link ?? ""} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedContainerId(container.id)
                              }
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingContainerId(container.id);
                                setNewForm({
                                  ref: container.ref || "",
                                  date:
                                    (container.date ||
                                      container.created_at ||
                                      new Date().toISOString().slice(0, 10)
                                    ).slice(0, 10),
                                  estimatedShipping:
                                    container.shipping_cost != null
                                      ? String(container.shipping_cost)
                                      : "",
                                  invoiceRef: container.invoice_ref || "",
                                  status:
                                    (container.status as NewContainerForm["status"]) ||
                                    "Loading",
                                  notes: container.notes || "",
                                  driveLink: container.drive_link || "",
                                });
                                setIsNewModalOpen(true);
                                setError(null);
                              }}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteContainer(container)}
                              className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-300"
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

        {/* Container detail side panel */}
        {selectedContainer && (
          <div className="rounded-lg border border-app surface p-4 text-xs text-app">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-sm font-semibold text-app">
                  Container {selectedContainer.ref || selectedContainer.id}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {formatDate(selectedContainer.date ?? selectedContainer.created_at)}{" "}
                  • Status:{" "}
                  <span className="font-semibold">
                    {selectedContainer.status || "Loading"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedContainerId(null)}
                className="rounded-md border border-app px-3 py-1 text-[11px] font-semibold text-app"
              >
                Close
              </button>
            </div>

            {/* Shipping summary */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-app bg-white p-3">
                <div className="text-[11px] font-semibold text-muted">
                  Estimated Shipping
                </div>
                <div className="mt-1 text-lg font-semibold text-app">
                  {formatMoney(selectedContainer.shipping_cost, "AED")}
                </div>
              </div>
              <div className="rounded-md border border-app bg-white p-3">
                <div className="text-[11px] font-semibold text-muted">
                  Actual Shipping
                </div>
                <div className="mt-1 text-lg font-semibold text-app">
                  {selectedContainer.shipping_paid
                    ? formatMoney(selectedContainer.shipping_cost, "AED")
                    : "-"}
                </div>
                {selectedContainer.invoice_ref && (
                  <div className="mt-1 text-[11px] text-muted">
                    Invoice: {selectedContainer.invoice_ref}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-app bg-white p-3">
                <div className="text-[11px] font-semibold text-muted">
                  Cars in container
                </div>
                <div className="mt-1 text-lg font-semibold text-app">
                  {totalCarsInContainer}
                </div>
              </div>
            </div>

            {selectedContainer.drive_link && (
              <div className="mt-3 rounded-md border border-app bg-white p-3">
                <div className="text-[11px] font-semibold text-muted">
                  Google Drive
                </div>
                <div className="mt-2">
                  <DriveLinkIcon href={selectedContainer.drive_link} />
                </div>
              </div>
            )}

            {/* Cars section */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Cars
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-md border border-app bg-white p-3 text-[11px] sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-app">
                    <input
                      type="radio"
                      checked={addCarForm.mode === "inventory"}
                      onChange={() => updateAddCarField("mode", "inventory")}
                    />
                    <span>From inventory</span>
                  </label>
                  <select
                    value={addCarForm.inventoryCarId}
                    onChange={(e) =>
                      updateAddCarField("inventoryCarId", e.target.value)
                    }
                    className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="">Select car from inventory</option>
                    {availableInventoryCars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`${c.brand || ""} ${c.model || ""} ${
                          c.year || ""
                        }`.trim()}{" "}
                        {c.owner === "Client" && c.client_name
                          ? `• Client: ${c.client_name}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-app">
                    <input
                      type="radio"
                      checked={addCarForm.mode === "manual"}
                      onChange={() => updateAddCarField("mode", "manual")}
                    />
                    <span>Add manually</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      placeholder="Brand"
                      value={addCarForm.brand}
                      onChange={(e) =>
                        updateAddCarField("brand", e.target.value)
                      }
                      className="rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                    />
                    <input
                      placeholder="Model"
                      value={addCarForm.model}
                      onChange={(e) =>
                        updateAddCarField("model", e.target.value)
                      }
                      className="rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                    />
                    <input
                      placeholder="Year"
                      value={addCarForm.year}
                      onChange={(e) =>
                        updateAddCarField("year", e.target.value)
                      }
                      className="rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                    />
                    <input
                      placeholder="Color"
                      value={addCarForm.color}
                      onChange={(e) =>
                        updateAddCarField("color", e.target.value)
                      }
                      className="rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-app">
                    <input
                      type="checkbox"
                      checked={addCarForm.isPartner}
                      onChange={(e) =>
                        updateAddCarField("isPartner", e.target.checked)
                      }
                    />
                    <span>Partner car</span>
                  </label>
                  {addCarForm.isPartner && (
                    <input
                      placeholder="Partner name"
                      value={addCarForm.partnerName}
                      onChange={(e) =>
                        updateAddCarField("partnerName", e.target.value)
                      }
                      className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-app">
                    Shipping contribution (AED, optional)
                  </label>
                  <input
                    placeholder="Override per-car cost"
                    value={addCarForm.shippingContribution}
                    onChange={(e) =>
                      updateAddCarField("shippingContribution", e.target.value)
                    }
                    className="w-full rounded-md border border-app bg-white px-2 py-1 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={handleAddCar}
                    disabled={isAddingCar}
                    className="mt-1 inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {isAddingCar ? "Adding..." : "Add Car to Container"}
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-app bg-black">
                <table className="w-full text-left text-[11px]">
                  <thead className="border-b border-app text-[10px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Car</th>
                      <th className="px-3 py-2">Owner</th>
                      <th className="px-3 py-2">Shipping</th>
                      <th className="px-3 py-2">Customs</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carsInContainer.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-3 text-xs text-muted"
                        >
                          No cars yet.
                        </td>
                      </tr>
                    ) : (
                      carsInContainer.map((cc) => {
                        const car =
                          cc.car_id &&
                          cars.find((c) => c.id === cc.car_id as string);
                        const owner = cc.is_partner ? "Partner" : "Axira";
                        return (
                          <tr
                            key={cc.id}
                            className="border-b border-app last:border-b-0"
                          >
                            <td className="px-3 py-2 text-app">
                              {cc.car_label ||
                                (car
                                  ? `${car.brand || ""} ${car.model || ""} ${
                                      car.year || ""
                                    }`.trim()
                                  : "-")}
                            </td>
                            <td className="px-3 py-2 text-app">
                              {owner}
                              {cc.is_partner && cc.partner_name && (
                                <span className="block text-[10px] text-muted">
                                  {cc.partner_name}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-app">
                              {cc.shipping_contribution != null
                                ? formatMoney(cc.shipping_contribution, "AED")
                                : "auto"}
                            </td>
                            <td className="px-3 py-2 text-app">
                              {cc.customs_status || "pending"}
                              {cc.customs_paid_dzd != null && (
                                <span className="block text-[10px] text-muted">
                                  Paid:{" "}
                                  {formatMoney(
                                    cc.customs_paid_dzd,
                                    "DZD"
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => handleRemoveCar(cc)}
                                className="rounded-md border border-app bg-white px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-300"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Shipping / invoice section */}
            <div className="mt-6 space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Shipping invoice
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-[11px] text-app">
                  <span className="font-semibold">Actual invoice amount (AED)</span>
                  <input
                    type="number"
                    value={payInvoiceForm.amount}
                    onChange={(e) =>
                      updatePayInvoiceField("amount", e.target.value)
                    }
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-app">
                  <span className="font-semibold">Pocket</span>
                  <select
                    value={payInvoiceForm.pocket}
                    onChange={(e) =>
                      updatePayInvoiceField(
                        "pocket",
                        e.target.value as PayInvoiceForm["pocket"]
                      )
                    }
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="Dubai Cash">Dubai Cash</option>
                    <option value="Dubai Bank">Dubai Bank</option>
                    <option value="Qatar">Qatar</option>
                    <option value="Algeria Cash">Algeria Cash</option>
                    <option value="Algeria Bank">Algeria Bank</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handlePayInvoice}
                    disabled={isPayingInvoice || !!selectedContainer.shipping_paid}
                    className="inline-flex w-full items-center justify-center rounded-md bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {selectedContainer.shipping_paid
                      ? "Invoice Paid"
                      : isPayingInvoice
                      ? "Paying..."
                      : "Pay Invoice & Split"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Container Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSavingNew && setIsNewModalOpen(false)}
          />
          <div className="relative w-full max-w-xl rounded-lg border border-app surface p-4 text-xs text-app shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-sm font-semibold text-app">
                  New Container
                </div>
                <div className="text-[11px] text-muted">
                  Create a container with estimated shipping cost.
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSavingNew && setIsNewModalOpen(false)}
                className="rounded-md border border-app px-3 py-1 text-[11px] font-semibold text-app"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="font-semibold text-app">
                  Reference <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input
                  value={newForm.ref}
                  onChange={(e) => updateNewField("ref", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-app">
                  Date <span className="text-[var(--color-accent)]">*</span>
                </span>
                <input
                  type="date"
                  value={newForm.date}
                  onChange={(e) => updateNewField("date", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-app">
                  Estimated shipping cost (AED)
                </span>
                <input
                  type="number"
                  value={newForm.estimatedShipping}
                  onChange={(e) =>
                    updateNewField("estimatedShipping", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-app">
                  Invoice reference (optional)
                </span>
                <input
                  value={newForm.invoiceRef}
                  onChange={(e) =>
                    updateNewField("invoiceRef", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-app">Status</span>
                <select
                  value={newForm.status}
                  onChange={(e) =>
                    updateNewField(
                      "status",
                      e.target.value as NewContainerForm["status"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-app">Google Drive Folder Link</span>
                <input
                  type="text"
                  value={newForm.driveLink}
                  onChange={(e) =>
                    updateNewField("driveLink", e.target.value)
                  }
                  placeholder="https://drive.google.com/..."
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <div className="sm:col-span-2">
                <label className="space-y-1">
                  <span className="font-semibold text-app">Notes</span>
                  <textarea
                    value={newForm.notes}
                    onChange={(e) =>
                      updateNewField("notes", e.target.value)
                    }
                    rows={3}
                    className="w-full resize-none rounded-md border border-app bg-white px-3 py-2 text-xs text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </div>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => !isSavingNew && setIsNewModalOpen(false)}
                disabled={isSavingNew}
                className="rounded-md border border-app bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateContainer}
                disabled={isSavingNew}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isSavingNew ? "Saving..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

