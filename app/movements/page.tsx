"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Movement, Rent } from "@/lib/types";
import type { ReceiptPDFData } from "@/lib/pdf/pdfTypes";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

const ReceiptDownloadButton = dynamic(
  () => import("@/components/PDFButtons").then((m) => m.ReceiptDownloadButton),
  { ssr: false }
);

type CashPosition = {
  id: string;
  pocket: string | null;
  amount: number | null;
  currency: string | null;
};

type DealOption = {
  id: string;
  client_name: string | null;
  car_label: string | null;
};

type MovementFormState = {
  date: string;
  type: "In" | "Out";
  category:
    | "Car Purchase"
    | "Shipping"
    | "Inspection"
    | "Recovery"
    | "Maintenance"
    | "Rent"
    | "Transfer"
    | "Opening Balance"
    | "Other";
  amount: string;
  currency: "AED" | "DZD" | "USD" | "EUR";
  pocket: "Dubai Cash" | "Dubai Bank" | "Algeria Cash" | "Algeria Bank" | "Qatar" | "EUR Cash" | "USD Cash";
  dealId: string;
  reference: string;
  notes: string;
};

const POCKETS: MovementFormState["pocket"][] = [
  "Dubai Cash",
  "Dubai Bank",
  "Algeria Cash",
  "Algeria Bank",
  "Qatar",
  "EUR Cash",
  "USD Cash",
];

const POCKETS_BY_CURRENCY: Record<MovementFormState["currency"], MovementFormState["pocket"][]> = {
  AED: ["Dubai Cash", "Dubai Bank", "Qatar"],
  DZD: ["Algeria Cash", "Algeria Bank"],
  USD: ["Dubai Cash", "USD Cash"],
  EUR: ["EUR Cash"],
};

const CATEGORIES: MovementFormState["category"][] = [
  "Car Purchase",
  "Shipping",
  "Inspection",
  "Recovery",
  "Maintenance",
  "Transfer",
  "Opening Balance",
  "Other",
];

const MANAGED_ELSEWHERE_CATEGORIES = [
  "Client Payment",
  "Conversion",
  "Cash Exchange",
  "Shipping",
  "Rent",
] as const;

function canEditDeleteMovement(category: string | null | undefined): boolean {
  const c = (category || "").trim();
  return !MANAGED_ELSEWHERE_CATEGORIES.includes(c as (typeof MANAGED_ELSEWHERE_CATEGORIES)[number]);
}

const emptyForm = (): MovementFormState => ({
  date: new Date().toISOString().slice(0, 10),
  type: "Out",
  category: "Car Purchase",
  amount: "",
  currency: "AED",
  pocket: "Dubai Cash",
  dealId: "",
  reference: "",
  notes: "",
});

type FilterTab =
  | "All"
  | "In"
  | "Out"
  | "Dubai Cash"
  | "Dubai Bank"
  | "Algeria Cash"
  | "Algeria Bank"
  | "Qatar"
  | "EUR Cash"
  | "USD Cash";

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const c = currency || "";
  return `${formatNumber(v)}${c ? ` ${c}` : ""}`;
}

function formatDescription(description: string | null | undefined): string | null {
  const s = description?.trim();
  if (!s) return null;
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const depositedBy = obj.depositedBy;
      const toCurrency = obj.toCurrency;
      if (
        depositedBy != null &&
        toCurrency != null &&
        (typeof depositedBy === "string" || typeof depositedBy === "number")
      ) {
        const amount = obj.amount != null ? formatNumber(Number(obj.amount)) : "—";
        const rate = obj.rate != null ? formatNumber(Number(obj.rate)) : "—";
        return `Conversion by ${String(depositedBy)}: ${amount} DZD → ${toCurrency} at rate ${rate}`;
      }
      return Object.entries(obj)
        .map(([k, v]) => `${k}: ${v == null ? "" : String(v)}`)
        .filter(Boolean)
        .join(", ");
    }
  } catch {
    // not JSON
  }
  return s;
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

export default function MovementsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cashPositions, setCashPositions] = useState<CashPosition[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [openDeals, setOpenDeals] = useState<DealOption[]>([]);
  const [rents, setRents] = useState<Rent[]>([]);

  const [rentForm, setRentForm] = useState({
    description: "",
    annual_amount: "",
    currency: "AED" as "AED" | "DZD",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    pocket: "" as MovementFormState["pocket"] | "",
    notes: "",
  });
  const [editingRent, setEditingRent] = useState<Rent | null>(null);
  const [loggingRentId, setLoggingRentId] = useState<string | null>(null);
  const [isDeletingRentId, setIsDeletingRentId] = useState<string | null>(null);
  const [isRentModalOpen, setIsRentModalOpen] = useState(false);
  const [isSavingRent, setIsSavingRent] = useState(false);
  const [rentError, setRentError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<FilterTab>("All");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState<Movement | null>(null);
  const [originalMovement, setOriginalMovement] = useState<{
    id: string;
    type: string;
    amount: number;
    pocket: string;
    currency: string;
  } | null>(null);
  const [form, setForm] = useState<MovementFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<ReceiptPDFData | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);

    const [
      { data: cashData, error: cashError },
      { data: movesData, error: movesError },
      { data: dealsData, error: dealsError },
      { data: rentsData, error: rentsError },
    ] = await Promise.all([
      supabase.from("cash_positions").select("id, pocket, amount, currency"),
      supabase.from("movements").select("*").order("date", { ascending: false }),
      supabase
        .from("deals")
        .select("id, client_name, car_label, status")
        .neq("status", "closed")
        .order("date", { ascending: false }),
      supabase.from("rents").select("*").order("start_date", { ascending: false }),
    ]);

    if (cashError || movesError || dealsError || rentsError) {
      setError(
        [
          "Failed to load movements data.",
          cashError?.message,
          movesError?.message,
          dealsError?.message,
          rentsError?.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    setCashPositions((cashData as CashPosition[]) ?? []);
    setMovements((movesData as Movement[]) ?? []);
    setRents((rentsData as Rent[]) ?? []);
    setOpenDeals(
      ((dealsData as any[]) ?? []).map((d) => ({
        id: d.id,
        client_name: d.client_name,
        car_label: d.car_label,
      }))
    );

    setIsLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pocketBalances = useMemo(() => {
    const map: Record<string, { amount: number; currency: string | null }> = {};
    for (const p of cashPositions) {
      const pocket = p.pocket || "";
      if (!pocket) continue;
      map[pocket] = {
        amount: p.amount || 0,
        currency: p.currency || null,
      };
    }
    return map;
  }, [cashPositions]);

  const filteredMovements = useMemo(() => {
    if (activeTab === "All") return movements;
    if (activeTab === "In") return movements.filter((m) => (m.type || "").toLowerCase() === "in");
    if (activeTab === "Out") return movements.filter((m) => (m.type || "").toLowerCase() === "out");
    return movements.filter((m) => (m.pocket || "") === activeTab);
  }, [activeTab, movements]);

  const updateField = <K extends keyof MovementFormState>(key: K, value: MovementFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.date) return "Date is required.";
    if (!form.amount.trim()) return "Amount is required.";
    if (parseNum(form.amount) <= 0) return "Amount must be greater than 0.";
    if (!form.pocket) return "Pocket is required.";
    // Currency/pocket rules
    if (form.currency === "DZD" && !["Algeria Cash", "Algeria Bank"].includes(form.pocket)) {
      return "DZD movements must go to Algeria Cash or Algeria Bank.";
    }
    if (form.currency === "AED" && !["Dubai Cash", "Dubai Bank", "Qatar"].includes(form.pocket)) {
      return "AED movements must go to Dubai Cash, Dubai Bank, or Qatar.";
    }
    if (form.currency === "USD" && !["Dubai Cash", "USD Cash"].includes(form.pocket)) {
      return "USD movements must go to Dubai Cash or USD Cash.";
    }
    if (form.currency === "EUR" && form.pocket !== "EUR Cash") {
      return "EUR movements must go to EUR Cash.";
    }
    return null;
  };

  const updateCashPosition = async (
    pocket: string | null | undefined,
    amount: number,
    currency: string | null | undefined,
    type: string | null | undefined
  ) => {
    if (!pocket || !currency || amount <= 0) return;

    const { data: row, error } = await supabase
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", pocket)
      .eq("currency", currency)
      .maybeSingle();

    if (error || !row) {
      // eslint-disable-next-line no-console
      if (error) console.log("Supabase fetch cash position error:", error);
      return;
    }

    const currentAmount = (row as { amount: number | null }).amount ?? 0;
    const isIn = (type || "").toLowerCase() === "in";
    const signed = isIn ? amount : -amount;
    const newAmount = currentAmount + signed;

    const { error: updateError } = await supabase
      .from("cash_positions")
      .update({ amount: newAmount })
      .eq("id", (row as { id: string }).id);

    if (updateError) {
      // eslint-disable-next-line no-console
      console.log("Supabase update cash position error:", updateError);
      return;
    }

    setCashPositions((prev) =>
      prev.map((p) =>
        p.id === (row as { id: string }).id ? { ...p, amount: newAmount } : p
      )
    );
  };

  const openModal = () => {
    setForm(emptyForm());
    setEditingMovement(null);
    setOriginalMovement(null);
    setIsModalOpen(true);
    setError(null);
  };

  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
  };

  const handleSave = async () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }

    setIsSaving(true);
    setError(null);

    const amount = parseNum(form.amount);
    const signedAmount = form.type === "In" ? amount : -amount;

    let rate: number | null = null;
    let aedEquivalent: number | null = null;

    if (form.currency === "USD" || form.currency === "EUR") {
      rate = 1;
      aedEquivalent = amount;
    } else if (form.currency === "AED") {
      rate = 1;
      aedEquivalent = amount;
    } else {
      rate = null;
      aedEquivalent = null;
    }

    const payload = {
      date: form.date,
      type: form.type,
      category: form.category,
      description: form.notes || null,
      amount,
      currency: form.currency,
      rate,
      aed_equivalent: aedEquivalent,
      pocket: form.pocket,
      deal_id: form.dealId || null,
      reference: form.reference || null,
    };

    // If editing, reverse old effect on cash_positions and then apply new one
    if (editingMovement && originalMovement) {
      // 1) Reverse original movement using flipped type
      const reversedType =
        originalMovement.type.toLowerCase() === "in" ? "Out" : "In";
      const okRev = await updateCashPosition(
        originalMovement.pocket,
        originalMovement.amount,
        originalMovement.currency,
        reversedType
      );
      if (!okRev) {
        setError("Could not reverse the original pocket balance. Nothing was changed.");
        setIsSaving(false);
        return;
      }

      // 2) Apply new movement
      const okNew = await updateCashPosition(form.pocket, amount, form.currency, form.type);
      if (!okNew) {
        const okRestore = await updateCashPosition(
          originalMovement.pocket,
          originalMovement.amount,
          originalMovement.currency,
          originalMovement.type.toLowerCase() === "in" ? "In" : "Out"
        );
        if (!okRestore) {
          setError(
            "Critical: failed to apply new pocket balance and failed to restore original balance. Cash positions may now be inconsistent; please review balances immediately."
          );
          setIsSaving(false);
          return;
        }
        setError(
          "Could not apply the new pocket balance. Cash positions were reverted to match the original movement."
        );
        setIsSaving(false);
        return;
      }

      // 3) Update movement row itself
      const { data: updated, error: updateMovementError } = await supabase
        .from("movements")
        .update(payload)
        .eq("id", editingMovement.id)
        .select("*")
        .single();

      if (updateMovementError) {
        // eslint-disable-next-line no-console
        console.log("Supabase update movement error:", updateMovementError);
        setError(
          [
            "Failed to update movement.",
            updateMovementError.message,
            updateMovementError.details,
            updateMovementError.hint,
          ]
            .filter(Boolean)
            .join(" ")
        );
        setIsSaving(false);
        return;
      }

      const updatedMovement = updated as Movement;
      setMovements((prev) =>
        prev.map((m) => (m.id === updatedMovement.id ? updatedMovement : m))
      );
      await logActivity({
        action: "updated",
        entity: "movement",
        entity_id: updatedMovement.id,
        description: `Movement updated – ${updatedMovement.category || "Movement"} ${updatedMovement.type || ""} ${amount} ${form.currency}`,
        amount,
        currency: form.currency,
      });
      setIsSaving(false);
      setIsModalOpen(false);
      setEditingMovement(null);
      setOriginalMovement(null);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("movements")
      .insert(payload)
      .select("*")
      .single();

    if (insertError) {
      // eslint-disable-next-line no-console
      console.log("Supabase insert movement error:", insertError);
      setError(
        [
          "Failed to add movement.",
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

    const newMovement = inserted as Movement;

    // 1) Apply new movement effect via helper (creates cash_positions row if missing)
    const pocketOk = await updateCashPosition(form.pocket, amount, form.currency, form.type);
    if (!pocketOk) {
      await supabase.from("movements").delete().eq("id", newMovement.id);
      setError(
        "Could not update the pocket balance (cash_positions). The movement was not saved. Add a matching pocket/currency in cash_positions or check database permissions."
      );
      setIsSaving(false);
      return;
    }
    await logActivity({
      action: "created",
      entity: "movement",
      entity_id: newMovement.id,
      description: `Movement added – ${form.category || "Movement"} ${form.type} ${amount} ${form.currency}`,
      amount,
      currency: form.currency,
    });
    // Telegram notification — new movement
    fetch("/api/telegram/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense_logged",
        data: {
          description: form.category || "Movement",
          amount,
          currency: form.currency,
          pocket: form.pocket,
        },
      }),
    }).catch(() => {});

    setMovements((prev) => [newMovement, ...prev]);
    setIsSaving(false);
    setIsModalOpen(false);

    // Build receipt
    const receiptNum = `RCP-${newMovement.id?.slice(0, 8).toUpperCase() ?? Date.now()}`;
    const receiptRows: ReceiptPDFData["rows"] = [
      { label: "Date", value: form.date },
      { label: "Type", value: form.type === "In" ? "Incoming" : "Outgoing" },
      { label: "Category", value: form.category },
      { label: "Amount", value: `${Number(form.amount).toLocaleString("en-US")} ${form.currency}`, highlight: true },
      { label: "Pocket", value: form.pocket },
    ];
    if (form.dealId) receiptRows.push({ label: "Related Deal", value: form.dealId });
    setPendingReceipt({
      receiptNumber: receiptNum,
      date: form.date,
      type: form.type === "In" ? "Incoming Payment" : `Expense — ${form.category}`,
      rows: receiptRows,
      notes: form.notes || undefined,
    });
  };

  const handleDelete = async (movement: Movement) => {
    if (!window.confirm("Delete this movement? This cannot be undone.")) return;
    setIsDeletingId(movement.id);
    setError(null);

    // 1) Fetch latest movement from DB to ensure we have amount / type / pocket / currency
    const { data: movementRow, error: fetchError } = await supabase
      .from("movements")
      .select("id, type, amount, currency, pocket")
      .eq("id", movement.id)
      .maybeSingle();

    if (fetchError) {
      // eslint-disable-next-line no-console
      console.log("Supabase fetch movement before delete error:", fetchError);
      setError("Failed to fetch movement before delete.");
      setIsDeletingId(null);
      return;
    }

    if (movementRow) {
      const amt = (movementRow as { amount: number | null }).amount ?? 0;
      const t = ((movementRow as { type: string | null }).type || "").toLowerCase();
      const reversedType = t === "in" ? "Out" : "In";
      const pocketName = (movementRow as { pocket: string | null }).pocket || "";
      const currency = (movementRow as { currency: string | null }).currency || "";

      // 2) Reverse movement by flipping type
      await updateCashPosition(pocketName, amt, currency, reversedType);
    }

    // 4) Delete movement record
    const { error: deleteError } = await supabase
      .from("movements")
      .delete()
      .eq("id", movement.id);

    if (deleteError) {
      // eslint-disable-next-line no-console
      console.log("Supabase delete movement error:", deleteError);
      setError(
        [
          "Failed to delete movement.",
          deleteError.message,
          deleteError.details,
          deleteError.hint,
        ]
          .filter(Boolean)
          .join(" ")
      );
      setIsDeletingId(null);
      return;
    }
    await logActivity({
      action: "deleted",
      entity: "movement",
      entity_id: movement.id,
      description: `Movement deleted – ${movement.category || "Movement"} ${movement.amount} ${movement.currency || ""}`,
      amount: movement.amount ?? undefined,
      currency: movement.currency ?? undefined,
    });

    // 5) Refresh movements + pocket balances from server
    await fetchAll();
    setIsDeletingId(null);
  };

  const dealLabel = (dealId: string | null) => {
    if (!dealId) return "";
    const d = openDeals.find((x) => x.id === dealId);
    if (!d) return "";
    const parts = [d.client_name, d.car_label].filter(Boolean);
    return parts.join(" • ");
  };

  const rentLastPaymentByRentId = useMemo(() => {
    const map: Record<string, string> = {};
    movements.forEach((m) => {
      if ((m.category || "").trim() !== "Rent" || !m.reference?.startsWith("rent:")) return;
      const parts = m.reference.split(":");
      if (parts.length >= 2 && parts[0] === "rent") {
        const id = parts[1];
        const d = m.date || m.created_at || "";
        if (!map[id] || (d && d > (map[id] || ""))) map[id] = d;
      }
    });
    return map;
  }, [movements]);

  const getRentCardInfo = (r: Rent) => {
    const monthly = (r.monthly_amount ?? r.annual_amount / 12) || 0;
    const paymentDate = rentLastPaymentByRentId[r.id] || null;
    let daysRemaining: number | null = null;
    if (r.end_date) {
      const end = new Date(r.end_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      daysRemaining = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
    }
    return { monthly, paymentDate, daysRemaining };
  };

  const validateRentForm = () => {
    if (!rentForm.description.trim()) return "Property name is required.";
    const annual = parseNum(rentForm.annual_amount);
    if (annual <= 0) return "Annual amount must be greater than 0.";
    if (!rentForm.start_date) return "Start date is required.";
    return null;
  };

  const handleSaveRent = async () => {
    const err = validateRentForm();
    if (err) {
      setRentError(err);
      return;
    }
    setIsSavingRent(true);
    setRentError(null);
    const annual = parseNum(rentForm.annual_amount);
    const desc = rentForm.notes.trim()
      ? `${rentForm.description.trim()}\n${rentForm.notes.trim()}`
      : rentForm.description.trim();
    const payload = {
      description: desc,
      annual_amount: annual,
      currency: rentForm.currency,
      start_date: rentForm.start_date,
      end_date: rentForm.end_date || null,
      pocket: rentForm.pocket || null,
      payment_frequency: "annually",
      status: "active",
    };

    try {
      if (editingRent) {
        const previousAnnual = editingRent.annual_amount || 0;
        const { data, error: updateError } = await supabase
          .from("rents")
          .update(payload)
          .eq("id", editingRent.id)
          .select("*")
          .single();

        if (updateError) {
          setRentError(updateError.message || "Failed to save rent.");
          setIsSavingRent(false);
          return;
        }

        const updatedRent = data as Rent;
        await logActivity({
          action: "updated",
          entity: "rent",
          entity_id: updatedRent.id,
          description: `Rent updated – ${(updatedRent.description || "").split("\n")[0] || updatedRent.id}`,
          amount: annual,
          currency: updatedRent.currency || "AED",
        });
        setRents((prev) => prev.map((r) => (r.id === updatedRent.id ? updatedRent : r)));

        // If annual amount changed and there is an existing payment for this year, adjust it
        const diff = annual - previousAnnual;
        if (diff !== 0) {
          const year = new Date().getFullYear();
          const { data: movementRow, error: movementError } = await supabase
            .from("movements")
            .select("id, amount, currency, pocket, type")
            .eq("category", "Rent")
            .like("reference", `rent:${updatedRent.id}:${year}`)
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!movementError && movementRow) {
            const m = movementRow as {
              id: string;
              amount: number | null;
              currency: string | null;
              pocket: string | null;
              type: string | null;
            };
            const newAmount = (m.amount || 0) + diff;

            // Update movement amount
            await supabase.from("movements").update({ amount: newAmount }).eq("id", m.id);

            // Adjust cash position by the difference
            const pocket = m.pocket || "";
            const currency = m.currency || updatedRent.currency || "AED";
            if (diff > 0) {
              // More expense: additional Out
              await updateCashPosition(pocket, Math.abs(diff), currency, "Out");
            } else {
              // Less expense: refund as In
              await updateCashPosition(pocket, Math.abs(diff), currency, "In");
            }

            // Reflect in local movements state
            setMovements((prev) =>
              prev.map((mv) => (mv.id === m.id ? { ...mv, amount: newAmount } : mv))
            );
          }
        }
      } else {
        const { data, error: insertError } = await supabase
          .from("rents")
          .insert(payload)
          .select("*")
          .single();
        if (insertError) {
          setRentError(insertError.message || "Failed to save rent.");
          setIsSavingRent(false);
          return;
        }
        const newRent = data as Rent;
        await logActivity({
          action: "created",
          entity: "rent",
          entity_id: newRent.id,
          description: `Rent added – ${(newRent.description || "").split("\n")[0] || newRent.id}`,
          amount: annual,
          currency: newRent.currency || "AED",
        });
        setRents((prev) => [newRent, ...prev]);
      }
    } finally {
      setIsSavingRent(false);
    }

    setRentForm({
      description: "",
      annual_amount: "",
      currency: "AED",
      start_date: new Date().toISOString().slice(0, 10),
      end_date: "",
      pocket: "",
      notes: "",
    });
    setEditingRent(null);
    setIsRentModalOpen(false);
  };

  const handleLogAnnualPayment = async (r: Rent) => {
    const pocket = (r.pocket as MovementFormState["pocket"]) || (r.currency === "DZD" ? "Algeria Cash" : "Dubai Cash");
    setLoggingRentId(r.id);
    setError(null);
    const amount = r.annual_amount || 0;
    const year = new Date().getFullYear();
    const payload = {
      date: new Date().toISOString().slice(0, 10),
      type: "Out",
      category: "Rent",
      description: r.description || null,
      amount,
      currency: r.currency || "AED",
      rate: r.currency === "AED" ? 1 : null,
      aed_equivalent: r.currency === "AED" ? amount : null,
      pocket,
      deal_id: null,
      reference: `rent:${r.id}:${year}`,
    };
    const { data: inserted, error: insertError } = await supabase
      .from("movements")
      .insert(payload)
      .select("*")
      .single();
    if (insertError) {
      setError(insertError.message || "Failed to log payment.");
      setLoggingRentId(null);
      return;
    }
    await updateCashPosition(pocket, amount, r.currency || "AED", "Out");
    await logActivity({
      action: "paid",
      entity: "rent",
      entity_id: r.id,
      description: `Rent payment – ${(r.description || "").split("\n")[0] || r.id} (${year})`,
      amount,
      currency: r.currency || "AED",
    });
    setMovements((prev) => [inserted as Movement, ...prev]);
    setLoggingRentId(null);
  };

  const handleEditRent = (r: Rent) => {
    setRentError(null);
    setEditingRent(r);
    setRentForm({
      description: r.description || "",
      annual_amount: String(r.annual_amount || ""),
      currency: (r.currency as "AED" | "DZD") || "AED",
      start_date: r.start_date || new Date().toISOString().slice(0, 10),
      end_date: r.end_date || "",
      pocket: (r.pocket as MovementFormState["pocket"]) || "",
      notes: "",
    });
    setIsRentModalOpen(true);
  };

  const handleDeleteRent = async (r: Rent) => {
    if (
      !window.confirm(
        "Delete this rent and all its payments? This will also reverse the cash movement."
      )
    ) {
      return;
    }
    setIsDeletingRentId(r.id);
    setRentError(null);

    // Find all movements linked to this rent (by reference pattern)
    const { data: movementRows, error: movesError } = await supabase
      .from("movements")
      .select("id, amount, currency, pocket, type, reference, description")
      .eq("category", "Rent")
      .like("reference", `rent:${r.id}:%`);

    if (movesError) {
      setRentError("Failed to load rent payments before delete.");
      setIsDeletingRentId(null);
      return;
    }

    const rentMovements = (movementRows as Movement[]) || [];

    // Reverse each payment on cash_positions
    for (const m of rentMovements) {
      const amt = m.amount || 0;
      const t = (m.type || "").toLowerCase();
      const reversedType = t === "out" ? "In" : "Out";
      await updateCashPosition(m.pocket, amt, m.currency, reversedType);
    }

    // Delete movements
    if (rentMovements.length > 0) {
      const { error: deleteMovesError } = await supabase
        .from("movements")
        .delete()
        .eq("category", "Rent")
        .like("reference", `rent:${r.id}:%`);

      if (deleteMovesError) {
        setRentError("Failed to delete rent payments.");
        setIsDeletingRentId(null);
        return;
      }

      setMovements((prev) =>
        prev.filter((m) => !m.reference?.startsWith(`rent:${r.id}:`))
      );
    }

    // Delete the rent record itself
    const { error: deleteRentError } = await supabase
      .from("rents")
      .delete()
      .eq("id", r.id);

    if (deleteRentError) {
      setRentError("Failed to delete rent.");
      setIsDeletingRentId(null);
      return;
    }
    await logActivity({
      action: "deleted",
      entity: "rent",
      entity_id: r.id,
      description: `Rent deleted – ${(r.description || "").split("\n")[0] || r.id}`,
      amount: r.annual_amount ?? undefined,
      currency: r.currency ?? undefined,
    });

    setRents((prev) => prev.filter((x) => x.id !== r.id));
    setIsDeletingRentId(null);
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Movements
            </h1>
              <p className="text-sm font-medium text-[var(--color-accent)]">
                Cash flow & pockets
              </p>
            </div>
            <button
              type="button"
              onClick={openModal}
              className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Add Movement
            </button>
          </header>

        {/* Pocket balances */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {POCKETS.map((pocket) => {
            const bal = pocketBalances[pocket];
            return (
              <div
                key={pocket}
                className="rounded-lg border border-[#222222] surface p-4 text-xs text-app"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {pocket}
                </div>
                <div className="mt-2 text-lg font-semibold text-app">
                  {bal ? formatMoney(bal.amount, bal.currency) : "0"}
                </div>
              </div>
            );
          })}
        </section>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              "All",
              "In",
              "Out",
              "Dubai Cash",
              "Dubai Bank",
              "Algeria Cash",
              "Algeria Bank",
              "Qatar",
              "EUR Cash",
              "USD Cash",
            ] as FilterTab[]
          ).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                activeTab === tab
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
                  : "border-[#222222] surface text-app hover:border-[var(--color-accent)]/70",
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

        {/* Rent & Fixed Expenses */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Rent &amp; Fixed Expenses
            </h2>
            <button
              type="button"
              onClick={() => {
                setRentError(null);
                setEditingRent(null);
                setRentForm({
                  description: "",
                  annual_amount: "",
                  currency: "AED",
                  start_date: new Date().toISOString().slice(0, 10),
                  end_date: "",
                  pocket: "",
                  notes: "",
                });
                setIsRentModalOpen(true);
              }}
              className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20"
            >
              Add Rent
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rents.map((r) => {
              const info = getRentCardInfo(r);
              const currency = r.currency || "AED";
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-[#222222] surface p-4 text-xs"
                >
                  <div className="font-semibold text-app">{r.description || "—"}</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted">
                    <span>Annual</span>
                    <span className="text-right text-app">
                      {formatMoney(r.annual_amount, currency)}
                    </span>
                    <span>Monthly equiv.</span>
                    <span className="text-right text-app">
                      {formatMoney(info.monthly, currency)}
                    </span>
                    <span>Payment date</span>
                    <span className="text-right text-app">
                      {info.paymentDate ? formatDate(info.paymentDate) : "—"}
                    </span>
                    <span>Days left in contract</span>
                    <span className="text-right text-app">
                      {info.daysRemaining != null ? info.daysRemaining : "—"}
                    </span>
                  </div>
                  <div className="mt-3 border-t border-[#222222] pt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleLogAnnualPayment(r)}
                      disabled={!!loggingRentId}
                      className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-50"
                    >
                      {loggingRentId === r.id ? "Logging…" : "Log Annual Payment"}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditRent(r)}
                        className="rounded border border-[#222222] px-2 py-1 text-[11px] text-app hover:border-zinc-500 hover:text-app"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRent(r)}
                        disabled={isDeletingRentId === r.id}
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:border-red-600 disabled:opacity-50"
                      >
                        {isDeletingRentId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {rents.length === 0 && (
            <div className="rounded-lg border border-[#222222] surface p-4 text-sm text-gray-400">
              No rent or fixed expenses. Click &quot;Add Rent&quot; to add one.
            </div>
          )}
        </section>

        {/* Movements table */}
        <div className="rounded-lg border border-[#222222] surface">
          {isLoading ? (
            <div className="p-4 text-sm text-muted">Loading movements...</div>
          ) : filteredMovements.length === 0 ? (
            <div className="p-4 text-sm text-muted">No movements found.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[640px] w-full text-left text-xs">
                <thead className="border-b border-[#222222] text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Pocket</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Deal</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Notes</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((m) => {
                    const isIn = (m.type || "").toLowerCase() === "in";
                    return (
                      <tr
                        key={m.id}
                        className="border-b border-[#222222] last:border-b-0"
                      >
                        <td className="px-4 py-3 text-app">
                          {formatDate(m.date ?? m.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={[
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              isIn
                                ? "bg-emerald-900/40 text-emerald-300"
                                : "bg-red-900/40 text-red-300",
                            ].join(" ")}
                          >
                            {isIn ? "In" : "Out"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-app">
                          {m.category || "-"}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {formatMoney(m.amount, m.currency)}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">
                          {m.pocket || "-"}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">
                          {dealLabel(m.deal_id ?? null)}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell truncate max-w-[150px]">
                          {formatDescription(m.description) ?? m.reference ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          {canEditDeleteMovement(m.category) ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMovement(m);
                                  setOriginalMovement({
                                    id: m.id!,
                                    type: m.type || "Out",
                                    amount: m.amount ?? 0,
                                    pocket: m.pocket || "",
                                    currency: m.currency || "",
                                  });
                                  setForm({
                                    date: m.date || new Date().toISOString().slice(0, 10),
                                    type:
                                      (m.type as "In" | "Out") ||
                                      "Out",
                                    category:
                                      (m.category as MovementFormState["category"]) ||
                                      "Car Purchase",
                                    amount: m.amount != null ? String(m.amount) : "",
                                    currency:
                                      (m.currency as MovementFormState["currency"]) || "AED",
                                    pocket:
                                      (m.pocket as MovementFormState["pocket"]) ||
                                      "Dubai Cash",
                                    dealId: m.deal_id || "",
                                    reference: m.reference || "",
                                    notes: m.description || "",
                                  });
                                  setIsModalOpen(true);
                                  setError(null);
                                }}
                                className="mr-2 rounded-md border border-[#222222] bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(m)}
                                disabled={isDeletingId === m.id}
                                className="rounded-md border border-[#222222] bg-white px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
                              >
                                {isDeletingId === m.id ? "Deleting..." : "Delete"}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-400 text-[11px]">—</span>
                          )}
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

      {/* Add Movement Modal */}
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative flex w-full max-w-3xl max-h-screen flex-col overflow-y-auto rounded-lg border border-[#222222] surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#222222] pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  Add Movement
                </div>
                <div className="text-xs text-muted">
                  Track cash in and out of each pocket.
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-[#222222] px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
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
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Type</span>
                <select
                  value={form.type}
                  onChange={(e) => updateField("type", e.target.value as "In" | "Out")}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="In">In</option>
                  <option value="Out">Out</option>
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Category</span>
                <select
                  value={form.category}
                  onChange={(e) =>
                    updateField(
                      "category",
                      e.target.value as MovementFormState["category"]
                    )
                  }
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Amount</span>
                <input
                  type="number"
                  value={form.amount}
                  onChange={(e) => updateField("amount", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Currency</span>
                <select
                  value={form.currency}
                  onChange={(e) => {
                    const newCurrency = e.target.value as MovementFormState["currency"];
                    updateField("currency", newCurrency);
                    const validPockets = POCKETS_BY_CURRENCY[newCurrency];
                    if (validPockets?.length && !validPockets.includes(form.pocket)) {
                      updateField("pocket", validPockets[0]);
                    }
                  }}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="AED">AED</option>
                  <option value="DZD">DZD</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Pocket</span>
                <select
                  value={form.pocket}
                  onChange={(e) =>
                    updateField(
                      "pocket",
                      e.target.value as MovementFormState["pocket"]
                    )
                  }
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {(POCKETS_BY_CURRENCY[form.currency] ?? POCKETS).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Deal (optional)</span>
                <select
                  value={form.dealId}
                  onChange={(e) => updateField("dealId", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">No deal linked</option>
                  {openDeals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {dealLabel(d.id) || d.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Reference (optional)</span>
                <input
                  value={form.reference}
                  onChange={(e) => updateField("reference", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Notes (optional)</span>
                <input
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[#222222] surface pt-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-[#222222] bg-white px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
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

      {/* ── Receipt Modal ─────────────────────────────────────────────── */}
      {pendingReceipt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/75" onClick={() => setPendingReceipt(null)} />
          <div className="relative flex w-full max-w-sm flex-col rounded-xl border border-app surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-red">Receipt Ready</p>
                <p className="mt-0.5 text-sm font-bold text-primary">#{pendingReceipt.receiptNumber}</p>
              </div>
              <button
                onClick={() => setPendingReceipt(null)}
                className="rounded p-1 text-secondary hover:bg-app transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="mb-4 divide-y divide-app rounded-lg border border-app overflow-hidden">
              {pendingReceipt.rows.map((row, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-secondary">{row.label}</span>
                  <span className={`text-xs font-semibold ${row.highlight ? "text-brand-red" : "text-primary"}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <p className="mb-4 text-center text-xs text-green-400">✓ Saved successfully</p>
            <div className="flex gap-2">
              <ReceiptDownloadButton
                data={pendingReceipt}
                label="⬇ Download Receipt"
                className="flex-1 rounded border border-brand-red/50 bg-brand-red/10 py-2.5 text-xs font-semibold text-brand-red hover:bg-brand-red/20 transition-colors"
              />
              <button
                onClick={() => setPendingReceipt(null)}
                className="flex-1 rounded border border-app py-2.5 text-xs font-semibold text-secondary hover:bg-app transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Rent Modal */}
      {isRentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSavingRent && setIsRentModalOpen(false)}
          />
          <div className="relative flex w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-[#222222] surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#222222] pb-3">
              <div>
                <div className="text-lg font-semibold text-app">Add Rent / Fixed Expense</div>
                <div className="text-xs text-muted">
                  Property or fixed expense with annual amount and schedule.
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSavingRent && setIsRentModalOpen(false)}
                disabled={isSavingRent}
                className="rounded-md border border-[#222222] px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                Close
              </button>
            </div>
            {rentError && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {rentError}
              </div>
            )}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Property / description</span>
                <input
                  type="text"
                  value={rentForm.description}
                  onChange={(e) => setRentForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Dubai warehouse"
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Annual amount</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={rentForm.annual_amount}
                  onChange={(e) => setRentForm((f) => ({ ...f, annual_amount: e.target.value }))}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Currency</span>
                <select
                  value={rentForm.currency}
                  onChange={(e) =>
                    setRentForm((f) => ({ ...f, currency: e.target.value as "AED" | "DZD" }))
                  }
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="AED">AED</option>
                  <option value="DZD">DZD</option>
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Start date</span>
                <input
                  type="date"
                  value={rentForm.start_date}
                  onChange={(e) => setRentForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Pocket paid from</span>
                <select
                  value={rentForm.pocket}
                  onChange={(e) =>
                    setRentForm((f) => ({
                      ...f,
                      pocket: e.target.value as MovementFormState["pocket"] | "",
                    }))
                  }
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">—</option>
                  {POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Notes (optional)</span>
                <input
                  type="text"
                  value={rentForm.notes}
                  onChange={(e) => setRentForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. landlord, contract ref"
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[#222222] pt-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => !isSavingRent && setIsRentModalOpen(false)}
                disabled={isSavingRent}
                className="rounded-md border border-[#222222] bg-white px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRent}
                disabled={isSavingRent}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSavingRent ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
  );
}

