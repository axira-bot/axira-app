"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "@heroui/react";
import dynamic from "next/dynamic";
import type { Movement, Rent } from "@/lib/types";
import type { ReceiptPDFData } from "@/lib/pdf/pdfTypes";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { PageContainer } from "@/components/ui/page-container";
import { formatDateForLocale, formatNumberForLocale, useI18n } from "@/lib/context/I18nContext";
import { movementCategoryLabel, movementTypeLabel, pocketDetailLabel } from "@/lib/i18n/enumLabels";

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

function parseNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

function sortMovementsByDateDesc(items: Movement[]): Movement[] {
  return [...items].sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    const byDate = db.localeCompare(da);
    if (byDate !== 0) return byDate;
    return (b.id ?? "").localeCompare(a.id ?? "");
  });
}

export default function MovementsPage() {
  const { canDelete } = useAuth();
  const { t, locale } = useI18n();

  const fmtNum = useCallback(
    (value: number) => formatNumberForLocale(locale, value, { maximumFractionDigits: 0 }),
    [locale]
  );

  const fmtMoney = useCallback(
    (value: number | null | undefined, currency: string | null | undefined) => {
      const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
      const c = currency || "";
      return `${fmtNum(v)}${c ? ` ${c}` : ""}`;
    },
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

  const formatDescription = useCallback(
    (description: string | null | undefined): string | null => {
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
            const amount = obj.amount != null ? fmtNum(Number(obj.amount)) : t("common.emiDash");
            const rate = obj.rate != null ? fmtNum(Number(obj.rate)) : t("common.emiDash");
            return t("movements.conversionDescription", {
              depositedBy: String(depositedBy),
              amount,
              toCurrency: String(toCurrency),
              rate,
            });
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
    },
    [fmtNum, t]
  );

  const filterTabLabel = useCallback(
    (tab: FilterTab) => {
      if (tab === "All") return t("movements.filterAll");
      if (tab === "In" || tab === "Out") return movementTypeLabel(t, tab);
      return pocketDetailLabel(t, tab);
    },
    [t]
  );

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
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

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
      supabase
        .from("movements")
        .select("*")
        .order("date", { ascending: false })
        .order("id", { ascending: false }),
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
          t("movements.loadFailed"),
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
    let list: Movement[];
    if (activeTab === "All") list = movements;
    else if (activeTab === "In") list = movements.filter((m) => (m.type || "").toLowerCase() === "in");
    else if (activeTab === "Out") list = movements.filter((m) => (m.type || "").toLowerCase() === "out");
    else list = movements.filter((m) => (m.pocket || "") === activeTab);
    return sortMovementsByDateDesc(list);
  }, [activeTab, movements]);

  const totalPages = Math.max(1, Math.ceil(filteredMovements.length / rowsPerPage));
  const paginatedMovements = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredMovements.slice(start, start + rowsPerPage);
  }, [filteredMovements, page, rowsPerPage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, rowsPerPage]);

  const updateField = <K extends keyof MovementFormState>(key: K, value: MovementFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.date) return t("movements.valDateRequired");
    if (!form.amount.trim()) return t("movements.valAmountRequired");
    if (parseNum(form.amount) <= 0) return t("movements.valAmountPositive");
    if (!form.pocket) return t("movements.valPocketRequired");
    // Currency/pocket rules
    if (form.currency === "DZD" && !["Algeria Cash", "Algeria Bank"].includes(form.pocket)) {
      return t("movements.valDzdPocket");
    }
    if (form.currency === "AED" && !["Dubai Cash", "Dubai Bank", "Qatar"].includes(form.pocket)) {
      return t("movements.valAedPocket");
    }
    if (form.currency === "USD" && !["Dubai Cash", "USD Cash"].includes(form.pocket)) {
      return t("movements.valUsdPocket");
    }
    if (form.currency === "EUR" && form.pocket !== "EUR Cash") {
      return t("movements.valEurPocket");
    }
    return null;
  };

  const updateCashPosition = async (
    pocket: string | null | undefined,
    amount: number,
    currency: string | null | undefined,
    type: string | null | undefined
  ): Promise<boolean> => {
    if (!pocket || !currency || amount <= 0) return false;

    const isIn = (type || "").toLowerCase() === "in";
    const signed = isIn ? amount : -amount;

    const { data: rows, error } = await supabase
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", pocket)
      .eq("currency", currency)
      .limit(1);

    if (error) {
      // eslint-disable-next-line no-console
      console.log("Supabase fetch cash position error:", error);
      return false;
    }

    const row = rows?.[0] as { id: string; amount: number | null } | undefined;

    if (!row) {
      const { data: inserted, error: insertError } = await supabase
        .from("cash_positions")
        .insert({ pocket, currency, amount: signed })
        .select("id, pocket, amount, currency")
        .single();

      if (insertError || !inserted) {
        // eslint-disable-next-line no-console
        console.log("Supabase insert cash position error:", insertError);
        return false;
      }

      setCashPositions((prev) => [...prev, inserted as CashPosition]);
      return true;
    }

    const currentAmount = row.amount ?? 0;
    const newAmount = currentAmount + signed;

    const { error: updateError } = await supabase
      .from("cash_positions")
      .update({ amount: newAmount })
      .eq("id", row.id);

    if (updateError) {
      // eslint-disable-next-line no-console
      console.log("Supabase update cash position error:", updateError);
      return false;
    }

    setCashPositions((prev) =>
      prev.map((p) => (p.id === row.id ? { ...p, amount: newAmount } : p))
    );
    return true;
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
        setError(t("movements.reversePocketFailed"));
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
          setError(t("movements.criticalPocketInconsistent"));
          setIsSaving(false);
          return;
        }
        setError(t("movements.newMovementReverted"));
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
            t("movements.failedUpdateMovementPrefix"),
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
          t("movements.failedAddMovementPrefix"),
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
      setError(t("movements.pocketBalanceNotSaved"));
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
      { label: t("movements.receiptRowDate"), value: form.date },
      {
        label: t("movements.receiptRowType"),
        value: form.type === "In" ? t("movements.receiptTypeIncoming") : t("movements.receiptTypeOutgoing"),
      },
      { label: t("movements.receiptRowCategory"), value: movementCategoryLabel(t, form.category) },
      { label: t("movements.receiptRowAmount"), value: `${fmtNum(Number(form.amount))} ${form.currency}`, highlight: true },
      { label: t("movements.receiptRowPocket"), value: pocketDetailLabel(t, form.pocket) },
    ];
    if (form.dealId) {
      receiptRows.push({ label: t("movements.receiptRowRelatedDeal"), value: dealLabel(form.dealId) || form.dealId });
    }
    setPendingReceipt({
      receiptNumber: receiptNum,
      date: form.date,
      type:
        form.type === "In"
          ? t("movements.receiptIncomingPayment")
          : t("movements.receiptExpensePrefix", { category: movementCategoryLabel(t, form.category) }),
      rows: receiptRows,
      notes: form.notes || undefined,
    });
  };

  const handleDelete = async (movement: Movement) => {
    if (!canDelete) return;
    if (!window.confirm(t("movements.deleteMovementConfirm"))) return;
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
      setError(t("movements.fetchMovementDeleteFailed"));
      setIsDeletingId(null);
      return;
    }

    if (movementRow) {
      const amt = (movementRow as { amount: number | null }).amount ?? 0;
      const rowType = ((movementRow as { type: string | null }).type || "").toLowerCase();
      const reversedType = rowType === "in" ? "Out" : "In";
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
          t("movements.failedDeleteMovement"),
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

  const rentPaidThisYearByRentId = useMemo(() => {
    const map: Record<string, boolean> = {};
    const currentYear = new Date().getFullYear();
    movements.forEach((m) => {
      if ((m.category || "").trim() !== "Rent" || !m.reference?.startsWith("rent:")) return;
      const parts = m.reference.split(":");
      const rentId = parts[1];
      const year = Number(parts[2]);
      if (rentId && Number.isFinite(year) && year === currentYear) {
        map[rentId] = true;
      }
    });
    return map;
  }, [movements]);

  const getRentCardInfo = (r: Rent) => {
    const monthly = (r.monthly_amount ?? r.annual_amount / 12) || 0;
    const paymentDate = rentLastPaymentByRentId[r.id] || null;
    const paidThisYear = Boolean(rentPaidThisYearByRentId[r.id]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(r.start_date);
    const anchorMonth = start.getMonth();
    const anchorDay = start.getDate();
    let nextDueDate = new Date(today.getFullYear(), anchorMonth, anchorDay);
    if (paidThisYear || nextDueDate < today) {
      nextDueDate = new Date(today.getFullYear() + 1, anchorMonth, anchorDay);
    }
    let daysRemaining: number | null = null;
    if (r.end_date) {
      const end = new Date(r.end_date);
      end.setHours(0, 0, 0, 0);
      daysRemaining = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
    }
    return { monthly, paymentDate, daysRemaining, nextDueDate };
  };

  const validateRentForm = () => {
    if (!rentForm.description.trim()) return t("movements.rentPropertyRequired");
    const annual = parseNum(rentForm.annual_amount);
    if (annual <= 0) return t("movements.rentAnnualPositive");
    if (!rentForm.start_date) return t("movements.rentStartRequired");
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
          setRentError(updateError.message || t("movements.rentSaveFailed"));
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
          const { data: movementRows, error: movementError } = await supabase
            .from("movements")
            .select("id, amount, currency, pocket, type, reference")
            .eq("category", "Rent")
            .like("reference", `rent:${updatedRent.id}:${year}:%`);

          if (!movementError && (movementRows ?? []).length > 0) {
            const rows = movementRows as {
              id: string;
              amount: number | null;
              currency: string | null;
              pocket: string | null;
              type: string | null;
              reference?: string | null;
            }[];
            const perRowDiff = diff / Math.max(1, rows.length);
            for (const m of rows) {
              const newAmount = (m.amount || 0) + perRowDiff;
              await supabase.from("movements").update({ amount: newAmount }).eq("id", m.id);
            }

            // Adjust cash position by the difference
            const pocket = rows[0]?.pocket || "";
            const currency = rows[0]?.currency || updatedRent.currency || "AED";
            if (diff > 0) {
              // More expense: additional Out
              await updateCashPosition(pocket, Math.abs(diff), currency, "Out");
            } else {
              // Less expense: refund as In
              await updateCashPosition(pocket, Math.abs(diff), currency, "In");
            }

            // Reflect in local movements state
            setMovements((prev) =>
              prev.map((mv) => {
                const updated = rows.find((r) => r.id === mv.id);
                if (!updated) return mv;
                return { ...mv, amount: (updated.amount || 0) + perRowDiff };
              })
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
          setRentError(insertError.message || t("movements.rentSaveFailed"));
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
    const annualAmount = r.annual_amount || 0;
    const year = new Date().getFullYear();
    const { data: existingRows, error: existingError } = await supabase
      .from("movements")
      .select("id")
      .eq("category", "Rent")
      .like("reference", `rent:${r.id}:${year}:%`)
      .limit(1);
    if (existingError) {
      setError(existingError.message || t("movements.rentPaymentsVerifyFailed"));
      setLoggingRentId(null);
      return;
    }
    if ((existingRows ?? []).length > 0) {
      setError(t("movements.rentYearAlreadyLogged"));
      setLoggingRentId(null);
      return;
    }

    const payload = {
      date: new Date().toISOString().slice(0, 10),
      type: "Out",
      category: "Rent",
      description: r.description || null,
      amount: annualAmount,
      currency: r.currency || "AED",
      rate: r.currency === "AED" ? 1 : null,
      aed_equivalent: r.currency === "AED" ? annualAmount : null,
      pocket,
      deal_id: null,
      reference: `rent:${r.id}:${year}:annual`,
    };
    const { data: inserted, error: insertError } = await supabase
      .from("movements")
      .insert(payload)
      .select("*")
      .single();
    if (insertError) {
      setError(insertError.message || t("movements.rentLogPaymentFailed"));
      setLoggingRentId(null);
      return;
    }
    await updateCashPosition(pocket, annualAmount, r.currency || "AED", "Out");
    await logActivity({
      action: "paid",
      entity: "rent",
      entity_id: r.id,
      description: `Rent payment – ${(r.description || "").split("\n")[0] || r.id} (${year})`,
      amount: annualAmount,
      currency: r.currency || "AED",
    });
    if (inserted) {
      setMovements((prev) => ([inserted as Movement, ...prev]));
    }
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
    if (!canDelete) return;
    if (!window.confirm(t("movements.rentDeleteConfirm"))) {
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
      setRentError(t("movements.rentPaymentsLoadFailed"));
      setIsDeletingRentId(null);
      return;
    }

    const rentMovements = (movementRows as Movement[]) || [];

    // Reverse each payment on cash_positions
    for (const m of rentMovements) {
      const amt = m.amount || 0;
      const movType = (m.type || "").toLowerCase();
      const reversedType = movType === "out" ? "In" : "Out";
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
        setRentError(t("movements.rentPaymentsDeleteFailed"));
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
      setRentError(t("movements.rentDeleteFailed"));
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
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="xl">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {t("movements.title")}
            </h1>
              <p className="text-sm font-medium text-danger">
                {t("movements.pageSubtitle")}
              </p>
            </div>
            <Button type="button" variant="primary" size="sm" onPress={openModal}>
              {t("movements.addMovement")}
            </Button>
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
                  {pocketDetailLabel(t, pocket)}
                </div>
                <div className="mt-2 text-lg font-semibold text-app">
                  {bal ? fmtMoney(bal.amount, bal.currency) : fmtNum(0)}
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

        {error ? (
          <Alert.Root status="danger">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        {/* Rent & Fixed Expenses */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t("movements.rentFixedExpenses")}
            </h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onPress={() => {
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
            >
              {t("movements.addRent")}
            </Button>
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
                  <div className="font-semibold text-app">{r.description || t("common.emiDash")}</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted">
                    <span>{t("movements.annual")}</span>
                    <span className="text-right text-app">
                      {fmtMoney(r.annual_amount, currency)}
                    </span>
                    <span>{t("movements.monthlyEquiv")}</span>
                    <span className="text-right text-app">
                      {fmtMoney(info.monthly, currency)}
                    </span>
                    <span>{t("movements.lastPayment")}</span>
                    <span className="text-right text-app">
                      {info.paymentDate ? fmtDate(info.paymentDate) : t("common.emiDash")}
                    </span>
                    <span>{t("movements.nextDueDate")}</span>
                    <span className="text-right text-app">
                      {fmtDate(info.nextDueDate.toISOString())}
                    </span>
                    <span>{t("movements.daysLeftContract")}</span>
                    <span className="text-right text-app">
                      {info.daysRemaining != null ? info.daysRemaining : t("common.emiDash")}
                    </span>
                  </div>
                  <div className="mt-3 border-t border-[#222222] pt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleLogAnnualPayment(r)}
                      disabled={!!loggingRentId}
                      className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-50"
                    >
                      {loggingRentId === r.id ? t("movements.loggingEllipsis") : t("movements.logYearlyPayment")}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditRent(r)}
                        className="rounded border border-[#222222] px-2 py-1 text-[11px] text-app hover:border-zinc-500 hover:text-app"
                      >
                        {t("common.edit")}
                      </button>
                      {canDelete ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteRent(r)}
                        disabled={isDeletingRentId === r.id}
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:border-red-600 disabled:opacity-50"
                      >
                        {isDeletingRentId === r.id ? t("movements.rowDeletingEllipsis") : t("common.delete")}
                      </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {rents.length === 0 && (
            <div className="rounded-lg border border-[#222222] surface p-4 text-sm text-gray-400">
              {t("movements.noRent")}
            </div>
          )}
        </section>

        {/* Movements table */}
        <div className="rounded-lg border border-[#222222] surface">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-default-500">
              <Spinner size="md" color="danger" />
              <span className="text-sm">{t("movements.loadingMovements")}</span>
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="p-4 text-sm text-muted">{t("movements.noMovementsFound")}</div>
          ) : (
            <>
            <div className="responsive-table-wrap">
              <table className="min-w-[620px] w-full text-left text-xs">
                <thead className="border-b border-[#222222] text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">{t("movements.date")}</th>
                    <th className="px-4 py-3">{t("movements.type")}</th>
                    <th className="px-4 py-3">{t("movements.category")}</th>
                    <th className="px-4 py-3">{t("movements.amount")}</th>
                    <th className="px-4 py-3 hidden sm:table-cell">{t("movements.pocket")}</th>
                    <th className="px-4 py-3 hidden sm:table-cell">{t("movements.colDeal")}</th>
                    <th className="px-4 py-3 hidden sm:table-cell">{t("movements.colNotes")}</th>
                    <th className="px-4 py-3">{t("movements.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMovements.map((m) => {
                    const isIn = (m.type || "").toLowerCase() === "in";
                    return (
                      <tr
                        key={m.id}
                        className="border-b border-[#222222] last:border-b-0"
                      >
                        <td className="px-4 py-3 text-app">
                          {fmtDate(m.date ?? m.created_at)}
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
                            {isIn ? movementTypeLabel(t, "In") : movementTypeLabel(t, "Out")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-app">
                          {movementCategoryLabel(t, m.category)}
                        </td>
                        <td className="px-4 py-3 text-app">
                          {fmtMoney(m.amount, m.currency)}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">
                          {m.pocket ? pocketDetailLabel(t, m.pocket) : t("common.emiDash")}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">
                          {dealLabel(m.deal_id ?? null)}
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell truncate max-w-[150px]">
                          {formatDescription(m.description) ?? m.reference ?? t("common.emiDash")}
                        </td>
                        <td className="px-4 py-3">
                          {canEditDeleteMovement(m.category) ? (
                            <RowActionsMenu label={t("movements.rowActionsMovement")}>
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
                                className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100"
                              >
                                {t("common.edit")}
                              </button>
                              {canDelete ? (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(m)}
                                  disabled={isDeletingId === m.id}
                                  className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                                >
                                  {isDeletingId === m.id ? t("movements.rowDeletingEllipsis") : t("common.delete")}
                                </button>
                              ) : null}
                            </RowActionsMenu>
                          ) : (
                            <span className="text-gray-400 text-[11px]">{t("common.emiDash")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#222222] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>{t("inventory.rowsPerPage")}</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(Number(e.target.value))}
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
                    start: (page - 1) * rowsPerPage + 1,
                    end: Math.min(page * rowsPerPage, filteredMovements.length),
                    total: filteredMovements.length,
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">
                  {t("inventory.pageOf", { page, pages: totalPages })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  isDisabled={page <= 1}
                  onPress={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  {t("inventory.pagerPrevious")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  isDisabled={page >= totalPages}
                  onPress={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  {t("inventory.pagerNext")}
                </Button>
              </div>
            </div>
            </>
          )}
        </div>
      </PageContainer>

      {/* Add Movement Modal */}
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative flex w-full max-w-3xl max-h-screen flex-col overflow-y-auto rounded-lg border border-[#222222] surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#222222] pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  {editingMovement ? t("movements.modalEditTitle") : t("movements.modalAddTitle")}
                </div>
                <div className="text-xs text-muted">
                  {t("movements.modalBlurb")}
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-[#222222] px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                {t("common.close")}
              </button>
            </div>

            <div className="mt-4 grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.date")}</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.type")}</span>
                <select
                  value={form.type}
                  onChange={(e) => updateField("type", e.target.value as "In" | "Out")}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="In">{movementTypeLabel(t, "In")}</option>
                  <option value="Out">{movementTypeLabel(t, "Out")}</option>
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.category")}</span>
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
                      {movementCategoryLabel(t, c)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.amount")}</span>
                <input
                  type="number"
                  value={form.amount}
                  onChange={(e) => updateField("amount", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.currency")}</span>
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
                <span className="font-semibold">{t("movements.pocket")}</span>
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
                      {pocketDetailLabel(t, p)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("movements.dealOptional")}</span>
                <select
                  value={form.dealId}
                  onChange={(e) => updateField("dealId", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">{t("movements.noDealLinked")}</option>
                  {openDeals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {dealLabel(d.id) || d.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.referenceOptional")}</span>
                <input
                  value={form.reference}
                  onChange={(e) => updateField("reference", e.target.value)}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("movements.notesOptional")}</span>
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
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSaving ? t("movements.savingEllipsis") : t("movements.saveMovement")}
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
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-red">{t("movements.receiptReady")}</p>
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
            <p className="mb-4 text-center text-xs text-green-400">{t("movements.receiptSaved")}</p>
            <div className="flex gap-2">
              <ReceiptDownloadButton
                data={pendingReceipt}
                label={t("movements.receiptDownload")}
                className="flex-1 rounded border border-brand-red/50 bg-brand-red/10 py-2.5 text-xs font-semibold text-brand-red hover:bg-brand-red/20 transition-colors"
              />
              <button
                onClick={() => setPendingReceipt(null)}
                className="flex-1 rounded border border-app py-2.5 text-xs font-semibold text-secondary hover:bg-app transition-colors"
              >
                {t("common.close")}
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
                <div className="text-lg font-semibold text-app">
                  {editingRent ? t("movements.rentModalEditTitle") : t("movements.rentModalAddTitle")}
                </div>
                <div className="text-xs text-muted">
                  {t("movements.rentModalBlurb")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSavingRent && setIsRentModalOpen(false)}
                disabled={isSavingRent}
                className="rounded-md border border-[#222222] px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                {t("common.close")}
              </button>
            </div>
            {rentError && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {rentError}
              </div>
            )}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("movements.rentDescriptionLabel")}</span>
                <input
                  type="text"
                  value={rentForm.description}
                  onChange={(e) => setRentForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder={t("movements.rentDescriptionPlaceholder")}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.rentAnnualLabel")}</span>
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
                <span className="font-semibold">{t("movements.currency")}</span>
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
                <span className="font-semibold">{t("movements.rentStartLabel")}</span>
                <input
                  type="date"
                  value={rentForm.start_date}
                  onChange={(e) => setRentForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full rounded-md border border-[#222222] bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("movements.rentPocketPaidFrom")}</span>
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
                  <option value="">{t("common.emiDash")}</option>
                  {POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {pocketDetailLabel(t, p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("movements.notesOptional")}</span>
                <input
                  type="text"
                  value={rentForm.notes}
                  onChange={(e) => setRentForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder={t("movements.rentNotesPlaceholder")}
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
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveRent}
                disabled={isSavingRent}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSavingRent ? t("movements.savingEllipsis") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
  );
}

