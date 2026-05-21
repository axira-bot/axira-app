/*
  SQL for Supabase (run in SQL Editor):

  -- Create debts table (if not exists)
  CREATE TABLE IF NOT EXISTS debts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type text NOT NULL CHECK (type IN ('receivable', 'payable')),
    name text NOT NULL,
    original_amount numeric NOT NULL DEFAULT 0,
    amount_paid numeric NOT NULL DEFAULT 0,
    amount_remaining numeric NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'AED',
    reason text,
    date date NOT NULL DEFAULT CURRENT_DATE,
    due_date date,
    notes text,
    status text NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding', 'partially_paid', 'settled')),
    created_at timestamptz DEFAULT now()
  );

  -- Add columns if table already exists without them:
  ALTER TABLE debts ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0;
  ALTER TABLE debts ADD COLUMN IF NOT EXISTS amount_remaining numeric;
  ALTER TABLE debts ADD COLUMN IF NOT EXISTS original_amount numeric;
  UPDATE debts SET original_amount = COALESCE(original_amount, 0), amount_paid = COALESCE(amount_paid, 0), amount_remaining = COALESCE(amount_remaining, original_amount - amount_paid) WHERE amount_remaining IS NULL;

  -- Create debt_payments table
  CREATE TABLE IF NOT EXISTS debt_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    debt_id uuid NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    amount numeric NOT NULL,
    currency text NOT NULL,
    date date NOT NULL,
    notes text,
    pocket text NOT NULL,
    created_at timestamptz DEFAULT now()
  );
*/

"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "@heroui/react";
import type { Car } from "@/lib/types";
import { logActivity } from "@/lib/activity";
import { reverseMovementOnCashPosition } from "@/lib/finance/applyCashPositionChange";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";
import {
  formatDateForLocale,
  formatNumberForLocale,
  useI18n,
  type TranslateFn,
} from "@/lib/context/I18nContext";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { PageContainer } from "@/components/ui/page-container";

type Debt = {
  id: string;
  type: "receivable" | "payable";
  name: string | null;
  original_amount: number | null;
  amount_paid: number | null;
  amount_remaining: number | null;
  currency: string | null;
  reason: string | null;
  date: string | null;
  due_date: string | null;
  notes: string | null;
  status: string | null;
  created_at?: string | null;
};

type DebtPayment = {
  id: string;
  debt_id: string;
  amount: number | null;
  currency: string | null;
  date: string | null;
  notes: string | null;
  pocket: string | null;
  created_at?: string | null;
};

const CURRENCIES = ["AED", "DZD", "EUR", "USD"] as const;
const STATUSES = ["outstanding", "partially_paid", "settled"] as const;

const POCKETS_BY_CURRENCY: Record<string, string[]> = {
  AED: ["Dubai Cash", "Dubai Bank", "Qatar"],
  DZD: ["Algeria Cash", "Algeria Bank"],
  USD: ["Dubai Cash", "USD Cash"],
  EUR: ["EUR Cash"],
};

type DebtFormState = {
  name: string;
  amount: string;
  currency: (typeof CURRENCIES)[number];
  reason: string;
  date: string;
  dueDate: string;
  notes: string;
  status: (typeof STATUSES)[number];
};

const emptyForm = (): DebtFormState => ({
  name: "",
  amount: "",
  currency: "AED",
  reason: "",
  date: new Date().toISOString().slice(0, 10),
  dueDate: "",
  notes: "",
  status: "outstanding",
});

function parseNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

function debtStatusNormalized(s: string | null | undefined): "outstanding" | "partially_paid" | "settled" {
  const v = (s || "").toLowerCase();
  if (v === "settled") return "settled";
  if (v === "partially_paid") return "partially_paid";
  return "outstanding";
}

function debtStatusTranslationKey(status: string | null | undefined): string {
  return `debts.statusValues.${debtStatusNormalized(status)}`;
}

/** UI label for cash pocket names (DB keeps English, e.g. `Dubai Cash`). */
function translatePocket(t: TranslateFn, pocket: string | null | undefined): string {
  const c = String(pocket ?? "").trim();
  if (!c) return "";
  const key = `debts.pockets.${c.replace(/\s+/g, "")}`;
  const translated = t(key);
  return translated === key ? c : translated;
}

function carLabel(c: Car): string {
  const parts = [c.brand, c.model, c.year ? String(c.year) : null].filter(Boolean);
  return parts.join(" ");
}

function debtPaymentMovementRef(paymentId: string): string {
  return `debt_payment:${paymentId}`;
}

type DebtPaymentMovementRow = {
  id: string;
  type: string | null;
  amount: number | null;
  currency: string | null;
  pocket: string | null;
};

async function findDebtPaymentMovement(
  payment: DebtPayment,
  debt: Debt,
  t: TranslateFn
): Promise<DebtPaymentMovementRow | null> {
  const ref = debtPaymentMovementRef(payment.id);
  const { data: byRef, error: refErr } = await supabase
    .from("movements")
    .select("id, type, amount, currency, pocket")
    .eq("reference", ref)
    .maybeSingle();

  if (refErr) throw new Error(refErr.message);
  if (byRef?.id) return byRef as DebtPaymentMovementRow;

  const amount = payment.amount ?? 0;
  const currency = payment.currency ?? "AED";
  const pocket = payment.pocket ?? "";
  const date = payment.date ?? "";
  if (amount <= 0 || !pocket || !date) return null;

  const isReceivable = (debt.type || "").toLowerCase() === "receivable";
  const namePart = debt.name?.trim() || t("debts.debtFallbackName");
  const expectedDescription = isReceivable
    ? t("debts.movementPaymentReceivedFrom", { name: namePart })
    : t("debts.movementPaymentPaidTo", { name: namePart });

  const { data: legacyRows, error: legacyErr } = await supabase
    .from("movements")
    .select("id, type, amount, currency, pocket")
    .eq("category", "Other")
    .eq("amount", amount)
    .eq("currency", currency)
    .eq("pocket", pocket)
    .eq("date", date)
    .eq("description", expectedDescription)
    .limit(2);

  if (legacyErr) throw new Error(legacyErr.message);
  if (!legacyRows?.length) return null;
  if (legacyRows.length > 1) {
    throw new Error(t("debts.deletePaymentAmbiguousMovement"));
  }
  return legacyRows[0] as DebtPaymentMovementRow;
}

type PayablesRow = Debt & { _isSupplier?: boolean; _carId?: string };

export default function DebtsPage() {
  const { locale, t } = useI18n();
  const { canDelete, profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"receivables" | "payables">("receivables");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [debts, setDebts] = useState<Debt[]>([]);
  const [cars, setCars] = useState<Car[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DebtFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  const [viewDebt, setViewDebt] = useState<Debt | null>(null);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentDate, setNewPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [newPaymentNote, setNewPaymentNote] = useState("");
  const [newPaymentPocket, setNewPaymentPocket] = useState("");
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fmtNum = (n: number) => formatNumberForLocale(locale, n, { maximumFractionDigits: 0 });

  const formatDateDisp = (value: string | null | undefined): string => {
    if (!value) return t("common.emiDash");
    const s = formatDateForLocale(locale, value);
    return s || t("common.emiDash");
  };

  const formatMoneyAmt = (value: number | null | undefined, currency: string): string => {
    const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
    return `${fmtNum(v)} ${currency || ""}`.trim();
  };

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);
    const [
      { data: debtsData, error: debtsError },
      { data: carsData, error: carsError },
    ] = await Promise.all([
      supabase.from("debts").select("*").order("date", { ascending: false }),
      supabase.from("cars").select("id, brand, model, year, supplier_owed, purchase_currency"),
    ]);
    if (debtsError) setError(debtsError.message);
    if (carsError) setError(carsError.message);
    setDebts((debtsData as Debt[]) ?? []);
    setCars((carsData as Car[]) ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const receivables = useMemo(
    () => debts.filter((d) => (d.type || "").toLowerCase() === "receivable"),
    [debts]
  );
  const payablesManual = useMemo(
    () => debts.filter((d) => (d.type || "").toLowerCase() === "payable"),
    [debts]
  );
  const supplierPayables = useMemo(
    () => cars.filter((c) => (c.supplier_owed ?? 0) > 0),
    [cars]
  );

  const receivableTotalsByCurrency = useMemo(() => {
    const map: Record<string, number> = {};
    receivables.forEach((d) => {
      const rem = d.amount_remaining ?? (d.original_amount ?? 0) - (d.amount_paid ?? 0);
      if (rem <= 0) return;
      const c = d.currency || "AED";
      map[c] = (map[c] ?? 0) + rem;
    });
    return map;
  }, [receivables]);

  const payableTotalsByCurrency = useMemo(() => {
    const map: Record<string, number> = {};
    payablesManual.forEach((d) => {
      const rem = d.amount_remaining ?? (d.original_amount ?? 0) - (d.amount_paid ?? 0);
      if (rem <= 0) return;
      const c = d.currency || "AED";
      map[c] = (map[c] ?? 0) + rem;
    });
    supplierPayables.forEach((c) => {
      const amt = c.supplier_owed ?? 0;
      if (amt <= 0) return;
      const cur = (c as Car & { purchase_currency?: string }).purchase_currency || "AED";
      map[cur] = (map[cur] ?? 0) + amt;
    });
    return map;
  }, [payablesManual, supplierPayables]);

  const listPayables = useMemo((): PayablesRow[] => {
    const fromSuppliers = supplierPayables.map((c) => {
      const typed = c as Car & { purchase_currency?: string };
      return {
        id: `car-${c.id}`,
        type: "payable" as const,
        name: t("debts.supplierDebtName", { car: carLabel(c) }),
        original_amount: c.supplier_owed ?? 0,
        amount_paid: 0,
        amount_remaining: c.supplier_owed ?? 0,
        currency: typed.purchase_currency ?? "AED",
        reason: t("debts.supplierReason"),
        date: null,
        due_date: null,
        notes: null,
        status: "outstanding",
        _isSupplier: true,
        _carId: c.id,
      } satisfies PayablesRow;
    });
    return [...payablesManual, ...fromSuppliers];
  }, [payablesManual, supplierPayables, t]);

  const modalTitle =
    editingId !== null
      ? activeTab === "receivables"
        ? t("debts.modalEditReceivable")
        : t("debts.modalEditPayable")
      : activeTab === "receivables"
        ? t("debts.modalAddReceivable")
        : t("debts.modalAddPayable");

  const updateField = <K extends keyof DebtFormState>(key: K, value: DebtFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setIsModalOpen(true);
    setError(null);
  };

  const openEdit = (d: Debt) => {
    setEditingId(d.id);
    setForm({
      name: d.name ?? "",
      amount: String(d.original_amount ?? d.amount_remaining ?? 0),
      currency: (d.currency as DebtFormState["currency"]) || "AED",
      reason: d.reason ?? "",
      date: d.date ?? new Date().toISOString().slice(0, 10),
      dueDate: d.due_date ?? "",
      notes: d.notes ?? "",
      status: debtStatusNormalized(d.status) as DebtFormState["status"],
    });
    setIsModalOpen(true);
    setError(null);
  };

  const closeModal = () => {
    if (!isSaving) {
      setIsModalOpen(false);
      setEditingId(null);
    }
  };

  const handleSaveDebt = async () => {
    if (!form.name.trim()) {
      setError(t("debts.nameRequired"));
      return;
    }
    const amount = parseNum(form.amount);
    if (amount <= 0) {
      setError(t("debts.amountPositive"));
      return;
    }
    setIsSaving(true);
    setError(null);

    const payload = {
      type: activeTab === "receivables" ? "receivable" : "payable",
      name: form.name.trim(),
      original_amount: amount,
      amount_paid: editingId ? undefined : 0,
      amount_remaining: editingId ? undefined : amount,
      currency: form.currency,
      reason: form.reason.trim() || null,
      date: form.date,
      due_date: form.dueDate || null,
      notes: form.notes.trim() || null,
      status: form.status,
    };

    if (editingId) {
      const existing = debts.find((d) => d.id === editingId);
      const paid = existing?.amount_paid ?? 0;
      const newRem = Math.max(amount - paid, 0);
      const newStatus = newRem <= 0 ? "settled" : paid > 0 ? "partially_paid" : "outstanding";
      const { error: updateErr } = await supabase
        .from("debts")
        .update({
          ...payload,
          amount_remaining: newRem,
          status: newStatus,
        })
        .eq("id", editingId);
      if (updateErr) {
        setError(updateErr.message);
        setIsSaving(false);
        return;
      }
      await logActivity({
        action: "updated",
        entity: "debt",
        entity_id: editingId,
        description: `Debt updated – ${form.name.trim()} – ${amount} ${form.currency}`,
        amount,
        currency: form.currency,
      });
      const typeValue: "receivable" | "payable" = activeTab === "receivables" ? "receivable" : "payable";
      const updatedFields = {
        ...payload,
        type: typeValue,
        original_amount: amount,
        amount_paid: paid,
        amount_remaining: newRem,
        status: newStatus,
      };
      setDebts((prev) =>
        prev.map((d) => {
          if (d.id !== editingId) return d;
          return { ...d, ...updatedFields } as Debt;
        })
      );
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("debts")
        .insert({
          ...payload,
          amount_paid: 0,
          amount_remaining: amount,
        })
        .select("*")
        .single();
      if (insertErr) {
        setError(insertErr.message);
        setIsSaving(false);
        return;
      }
      const newDebt = inserted as Debt;
      await logActivity({
        action: "created",
        entity: "debt",
        entity_id: newDebt.id,
        description: `Debt added – ${newDebt.name ?? ""} – ${amount} ${form.currency} (${(newDebt.type || "").toLowerCase()})`,
        amount,
        currency: form.currency,
      });
      setDebts((prev) => [newDebt, ...prev]);
    }
    setIsSaving(false);
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleMarkSettled = async (d: Debt) => {
    const orig = d.original_amount ?? 0;
    const paid = d.amount_paid ?? 0;
    const rem = d.amount_remaining ?? Math.max(orig - paid, 0);
    if (rem <= 0) return;
    const { error: updateErr } = await supabase
      .from("debts")
      .update({
        amount_paid: orig,
        amount_remaining: 0,
        status: "settled",
      })
      .eq("id", d.id);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    await logActivity({
      action: "updated",
      entity: "debt",
      entity_id: d.id,
      description: `Debt settled – ${d.name ?? ""} – ${orig} ${d.currency ?? ""}`,
      amount: orig,
      currency: d.currency ?? undefined,
    });
    setDebts((prev) =>
      prev.map((x) =>
        x.id === d.id
          ? { ...x, amount_paid: orig, amount_remaining: 0, status: "settled" }
          : x
      )
    );
    if (viewDebt?.id === d.id) {
      setViewDebt((v) => (v && v.id === d.id ? { ...v, amount_paid: orig, amount_remaining: 0, status: "settled" } : v));
    }
  };

  const handleDeleteDebt = async (d: Debt) => {
    if (!canDelete) return;
    if (!window.confirm(t("debts.deleteDebtConfirm"))) return;
    setDeletingId(d.id);
    const { error: delErr } = await supabase.from("debts").delete().eq("id", d.id);
    if (delErr) {
      setError(delErr.message);
      setDeletingId(null);
      return;
    }
    await logActivity({
      action: "deleted",
      entity: "debt",
      entity_id: d.id,
      description: `Debt deleted – ${d.name ?? ""} – ${d.original_amount ?? 0} ${d.currency ?? ""}`,
      amount: d.original_amount ?? undefined,
      currency: d.currency ?? undefined,
    });
    setDebts((prev) => prev.filter((x) => x.id !== d.id));
    if (viewDebt?.id === d.id) setViewDebt(null);
    setDeletingId(null);
  };

  const openView = async (d: Debt) => {
    setViewDebt(d);
    setDebtPayments([]);
    setPaymentsError(null);
    setPaymentsLoading(true);
    setNewPaymentAmount("");
    setNewPaymentDate(new Date().toISOString().slice(0, 10));
    setNewPaymentNote("");
    setNewPaymentPocket((POCKETS_BY_CURRENCY[d.currency || "AED"] ?? [])[0] ?? "");
    setIsPaymentFormOpen(false);

    const { data, error: pErr } = await supabase
      .from("debt_payments")
      .select("*")
      .eq("debt_id", d.id)
      .order("date", { ascending: false });
    if (pErr) {
      setPaymentsError(pErr.message);
      setDebtPayments([]);
    } else {
      setDebtPayments((data as DebtPayment[]) ?? []);
    }
    setPaymentsLoading(false);
  };

  const closeView = () => {
    setViewDebt(null);
    setDebtPayments([]);
    setPaymentsError(null);
  };

  const handleAddPayment = async () => {
    if (!viewDebt) return;
    const amount = parseNum(newPaymentAmount);
    if (amount <= 0) {
      setPaymentsError(t("debts.paymentAmountPositive"));
      return;
    }
    const currency = viewDebt.currency || "AED";
    const remaining = viewDebt.amount_remaining ?? 0;
    if (amount > remaining) {
      setPaymentsError(
        t("debts.paymentExceeds", {
          amount: fmtNum(remaining),
          currency,
        })
      );
      return;
    }
    const pocket = newPaymentPocket || (POCKETS_BY_CURRENCY[currency] ?? [])[0];
    if (!pocket) {
      setPaymentsError(t("debts.selectPocket"));
      return;
    }
    const date = newPaymentDate || new Date().toISOString().slice(0, 10);

    setIsAddingPayment(true);
    setPaymentsError(null);

    const { data: inserted, error: payErr } = await supabase
      .from("debt_payments")
      .insert({
        debt_id: viewDebt.id,
        amount,
        currency,
        date,
        notes: newPaymentNote.trim() || null,
        pocket,
      })
      .select("*")
      .single();

    if (payErr) {
      setPaymentsError(payErr.message);
      setIsAddingPayment(false);
      return;
    }

    const prevPaid = viewDebt.amount_paid ?? 0;
    const prevRem = viewDebt.amount_remaining ?? 0;
    const newPaid = prevPaid + amount;
    const newRem = Math.max(prevRem - amount, 0);
    const newStatus = newRem <= 0 ? "settled" : newPaid > 0 ? "partially_paid" : "outstanding";

    const { error: debtUpErr } = await supabase
      .from("debts")
      .update({
        amount_paid: newPaid,
        amount_remaining: newRem,
        status: newStatus,
      })
      .eq("id", viewDebt.id);

    if (debtUpErr) {
      setPaymentsError(debtUpErr.message);
      setIsAddingPayment(false);
      return;
    }

    const isReceivable = (viewDebt.type || "").toLowerCase() === "receivable";
    const namePart = viewDebt.name?.trim() || t("debts.debtFallbackName");
    const movementDescription = isReceivable
      ? t("debts.movementPaymentReceivedFrom", { name: namePart })
      : t("debts.movementPaymentPaidTo", { name: namePart });

    const paymentRow = inserted as DebtPayment;

    const { data: movementRow, error: movementErr } = await supabase
      .from("movements")
      .insert({
        date,
        type: isReceivable ? "In" : "Out",
        category: "Other",
        description: movementDescription,
        amount,
        currency,
        pocket,
        rate: null,
        aed_equivalent: null,
        deal_id: null,
        payment_id: null,
        reference: debtPaymentMovementRef(paymentRow.id),
      })
      .select("id")
      .single();

    if (movementErr || !movementRow?.id) {
      setPaymentsError(movementErr?.message ?? t("debts.paymentMovementFailed"));
      await supabase.from("debt_payments").delete().eq("id", paymentRow.id);
      await supabase
        .from("debts")
        .update({
          amount_paid: prevPaid,
          amount_remaining: prevRem,
          status: viewDebt.status ?? "outstanding",
        })
        .eq("id", viewDebt.id);
      setIsAddingPayment(false);
      return;
    }
    await logActivity({
      action: "paid",
      entity: "debt",
      entity_id: viewDebt.id,
      description: `Debt payment – ${viewDebt.name ?? ""} – ${amount} ${currency}`,
      amount,
      currency,
    });

    const { data: posRow } = await supabase
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", pocket)
      .eq("currency", currency)
      .maybeSingle();

    if (posRow && (posRow as { id?: string }).id) {
      const current = (posRow as { amount?: number }).amount ?? 0;
      const newAmount = isReceivable ? current + amount : current - amount;
      await supabase
        .from("cash_positions")
        .update({ amount: newAmount })
        .eq("id", (posRow as { id: string }).id);
    }

    setDebtPayments((prev) => [inserted as DebtPayment, ...prev]);
    setViewDebt((v) =>
      v && v.id === viewDebt.id ? { ...v, amount_paid: newPaid, amount_remaining: newRem, status: newStatus } : v
    );
    setDebts((prev) =>
      prev.map((d) =>
        d.id === viewDebt.id ? { ...d, amount_paid: newPaid, amount_remaining: newRem, status: newStatus } : d
      )
    );
    setNewPaymentAmount("");
    setNewPaymentNote("");
    setIsAddingPayment(false);
    setIsPaymentFormOpen(false);
  };

  const handleDeletePayment = async (payment: DebtPayment) => {
    if (!canDelete) return;
    if (!viewDebt) return;
    const amount = payment.amount ?? 0;
    if (amount <= 0) return;
    if (!window.confirm(t("debts.deletePaymentConfirm"))) return;

    setDeletingPaymentId(payment.id);
    setPaymentsError(null);

    const prevPaid = viewDebt.amount_paid ?? 0;
    const prevRem = viewDebt.amount_remaining ?? 0;
    const prevStatus = viewDebt.status ?? "outstanding";
    const newPaid = Math.max(prevPaid - amount, 0);
    const newRem = prevRem + amount;
    const newStatus = newRem <= 0 ? "settled" : newPaid > 0 ? "partially_paid" : "outstanding";

    const actorLabel =
      profile?.name?.trim() || user?.email?.trim() || t("debts.debtFallbackName");
    const debtRef = viewDebt.name?.trim() || viewDebt.id;
    const currency = payment.currency ?? "AED";
    const pocket = payment.pocket ?? "";

    let movement: DebtPaymentMovementRow | null = null;
    try {
      movement = await findDebtPaymentMovement(payment, viewDebt, t);
    } catch (err) {
      setPaymentsError(err instanceof Error ? err.message : t("debts.deletePaymentFailed"));
      setDeletingPaymentId(null);
      return;
    }

    if (movement) {
      const rev = await reverseMovementOnCashPosition(supabase, movement);
      if (!rev.ok) {
        setPaymentsError(
          [t("debts.deletePaymentCashFailed"), rev.error].filter(Boolean).join(" ")
        );
        setDeletingPaymentId(null);
        return;
      }

      const { error: delMoveErr } = await supabase
        .from("movements")
        .delete()
        .eq("id", movement.id);
      if (delMoveErr) {
        setPaymentsError(
          [t("debts.deletePaymentMovementFailed"), delMoveErr.message].filter(Boolean).join(" ")
        );
        setDeletingPaymentId(null);
        return;
      }
    }

    const { error: debtUpErr } = await supabase
      .from("debts")
      .update({
        amount_paid: newPaid,
        amount_remaining: newRem,
        status: newStatus,
      })
      .eq("id", viewDebt.id);

    if (debtUpErr) {
      setPaymentsError(debtUpErr.message);
      setDeletingPaymentId(null);
      return;
    }

    const { error: delPayErr } = await supabase
      .from("debt_payments")
      .delete()
      .eq("id", payment.id);

    if (delPayErr) {
      await supabase
        .from("debts")
        .update({
          amount_paid: prevPaid,
          amount_remaining: prevRem,
          status: prevStatus,
        })
        .eq("id", viewDebt.id);
      setPaymentsError(delPayErr.message);
      setDeletingPaymentId(null);
      return;
    }

    const description = movement
      ? `${actorLabel} deleted debt payment of ${amount} ${currency} on debt ${debtRef}. Cash reversed on pocket ${pocket}.`
      : `${actorLabel} deleted debt payment of ${amount} ${currency} on debt ${debtRef}. Movement reference not found. Only debt_payments row removed. Verify pocket balances manually.`;

    await logActivity({
      action: "deleted",
      entity: "debt_payment",
      entity_id: payment.id,
      description,
      amount: movement ? (movement.type?.toLowerCase() === "in" ? -amount : amount) : null,
      currency,
      actorName: actorLabel,
    });

    setDebtPayments((prev) => prev.filter((p) => p.id !== payment.id));
    setViewDebt((v) =>
      v && v.id === viewDebt.id
        ? { ...v, amount_paid: newPaid, amount_remaining: newRem, status: newStatus }
        : v
    );
    setDebts((prev) =>
      prev.map((d) =>
        d.id === viewDebt.id
          ? { ...d, amount_paid: newPaid, amount_remaining: newRem, status: newStatus }
          : d
      )
    );
    setDeletingPaymentId(null);
  };

  const listReceivables = receivables;

  return (
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("debts.title")}</h1>
          <p className="text-sm font-medium text-danger">{t("debts.subtitle")}</p>
        </header>

        <div className="flex flex-wrap gap-2">
          {(["receivables", "payables"] as const).map((tab) => (
            <Button
              key={tab}
              type="button"
              size="sm"
              variant={activeTab === tab ? "primary" : "outline"}
              onPress={() => setActiveTab(tab)}
            >
              {tab === "receivables" ? t("debts.tabReceivables") : t("debts.tabPayables")}
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

        {activeTab === "receivables" && (
          <>
            <div className="rounded-lg border border-app surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t("debts.totalOutstandingReceivables")}
              </h2>
              <div className="mt-2 flex flex-wrap gap-4">
                {Object.entries(receivableTotalsByCurrency).length === 0 ? (
                  <span className="text-gray-400">{t("debts.noOutstandingTotal")}</span>
                ) : (
                  Object.entries(receivableTotalsByCurrency).map(([cur, sum]) => (
                    <span key={cur} className="text-lg font-semibold text-emerald-400">
                      {formatMoneyAmt(sum, cur)}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app">{t("debts.tabReceivables")}</h2>
              <Button type="button" variant="primary" size="sm" onPress={openAdd}>
                {t("debts.addReceivable")}
              </Button>
            </div>
            <div className="rounded-lg border border-app surface overflow-hidden">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 p-8 text-default-500">
                  <Spinner size="md" color="danger" />
                  <span className="text-sm">{t("common.loadingEllipsis")}</span>
                </div>
              ) : listReceivables.length === 0 ? (
                <div className="p-8 text-center text-gray-400">{t("debts.emptyReceivables")}</div>
              ) : (
                <div className="responsive-table-wrap">
                  <table className="min-w-[620px] w-full text-left text-xs">
                    <thead className="border-b border-app text-muted">
                      <tr>
                        <th className="px-4 py-3">{t("debts.thName")}</th>
                        <th className="px-4 py-3 text-right">{t("debts.thAmount")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">{t("debts.thCurrency")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">{t("debts.thReason")}</th>
                        <th className="px-4 py-3">{t("debts.thDate")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">{t("debts.thDueDate")}</th>
                        <th className="px-4 py-3">{t("debts.thStatus")}</th>
                        <th className="px-4 py-3">{t("debts.thActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listReceivables.map((d) => (
                        <tr key={d.id} className="border-b border-app last:border-b-0">
                          <td className="px-4 py-3 font-medium text-app">{d.name ?? t("common.emiDash")}</td>
                          <td className="px-4 py-3 text-right text-app">
                            {formatMoneyAmt(d.amount_remaining ?? d.original_amount, d.currency ?? "AED")}
                          </td>
                          <td className="px-4 py-3 text-app hidden sm:table-cell">{d.currency ?? t("common.emiDash")}</td>
                          <td className="px-4 py-3 text-app hidden sm:table-cell">{d.reason ?? t("common.emiDash")}</td>
                          <td className="px-4 py-3 text-app">{formatDateDisp(d.date)}</td>
                          <td className="px-4 py-3 text-app hidden sm:table-cell">{formatDateDisp(d.due_date)}</td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                debtStatusNormalized(d.status) === "settled"
                                  ? "rounded bg-emerald-900/50 px-2 py-0.5 text-emerald-300"
                                  : debtStatusNormalized(d.status) === "partially_paid"
                                    ? "rounded bg-amber-900/50 px-2 py-0.5 text-amber-300"
                                    : "rounded bg-zinc-700/50 px-2 py-0.5 text-app"
                              }
                            >
                              {t(debtStatusTranslationKey(d.status))}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <RowActionsMenu label={t("debts.menuReceivableActions")}>
                              <button
                                type="button"
                                onClick={() => openView(d)}
                                className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100"
                              >
                                {t("debts.view")}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEdit(d)}
                                className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100"
                              >
                                {t("debts.edit")}
                              </button>
                              {(d.amount_remaining ?? 0) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkSettled(d)}
                                  className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-emerald-600 hover:bg-emerald-100"
                                >
                                  {t("debts.markSettled")}
                                </button>
                              )}
                              {canDelete ? (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDebt(d)}
                                  disabled={deletingId === d.id}
                                  className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                                >
                                  {deletingId === d.id ? t("debts.deleting") : t("debts.delete")}
                                </button>
                              ) : null}
                            </RowActionsMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "payables" && (
          <>
            <div className="rounded-lg border border-app surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("debts.totalPayable")}</h2>
              <div className="mt-2 flex flex-wrap gap-4">
                {Object.entries(payableTotalsByCurrency).length === 0 ? (
                  <span className="text-gray-400">{t("debts.noPayablesTotal")}</span>
                ) : (
                  Object.entries(payableTotalsByCurrency).map(([cur, sum]) => (
                    <span key={cur} className="text-lg font-semibold text-red-400">{formatMoneyAmt(sum, cur)}</span>
                  ))
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app">{t("debts.tabPayables")}</h2>
              <Button type="button" variant="primary" size="sm" onPress={openAdd}>
                {t("debts.addPayable")}
              </Button>
            </div>
            <div className="rounded-lg border border-app surface overflow-hidden">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 p-8 text-default-500">
                  <Spinner size="md" color="danger" />
                  <span className="text-sm">{t("common.loadingEllipsis")}</span>
                </div>
              ) : listPayables.length === 0 ? (
                <div className="p-8 text-center text-gray-400">{t("debts.emptyPayables")}</div>
              ) : (
                <div className="responsive-table-wrap">
                  <table className="min-w-[620px] w-full text-left text-xs">
                    <thead className="border-b border-app text-muted">
                      <tr>
                        <th className="px-4 py-3">{t("debts.thName")}</th>
                        <th className="px-4 py-3 text-right">{t("debts.thAmount")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">{t("debts.thCurrency")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">{t("debts.thReason")}</th>
                        <th className="px-4 py-3">{t("debts.thDate")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">{t("debts.thDueDate")}</th>
                        <th className="px-4 py-3">{t("debts.thStatus")}</th>
                        <th className="px-4 py-3">{t("debts.thActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listPayables.map((item) => {
                        const isSupplier = "_isSupplier" in item && item._isSupplier;
                        const d = item as PayablesRow;
                        return (
                          <tr key={d.id} className="border-b border-app last:border-b-0">
                            <td className="px-4 py-3 font-medium text-app">{d.name ?? t("common.emiDash")}</td>
                            <td className="px-4 py-3 text-right text-app">
                              {formatMoneyAmt(d.amount_remaining ?? d.original_amount, d.currency ?? "AED")}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">{d.currency ?? t("common.emiDash")}</td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">{d.reason ?? t("common.emiDash")}</td>
                            <td className="px-4 py-3 text-app">{formatDateDisp(d.date)}</td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">{formatDateDisp(d.due_date)}</td>
                            <td className="px-4 py-3">
                              <span className="rounded bg-zinc-700/50 px-2 py-0.5 text-app">
                                {t(debtStatusTranslationKey(d.status))}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {!isSupplier && (
                                <RowActionsMenu label={t("debts.menuPayableActions")}>
                                  <button
                                    type="button"
                                    onClick={() => openView(d)}
                                    className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100"
                                  >
                                    {t("debts.view")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEdit(d)}
                                    className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100"
                                  >
                                    {t("debts.edit")}
                                  </button>
                                  {(d.amount_remaining ?? 0) > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleMarkSettled(d)}
                                      className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-emerald-600 hover:bg-emerald-100"
                                    >
                                      {t("debts.markSettled")}
                                    </button>
                                  )}
                                  {canDelete ? (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDebt(d)}
                                      disabled={deletingId === d.id}
                                      className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                                    >
                                      {deletingId === d.id ? t("debts.deleting") : t("debts.delete")}
                                    </button>
                                  ) : null}
                                </RowActionsMenu>
                              )}
                              {isSupplier && <span className="text-gray-400 text-[11px]">{t("debts.fromInventory")}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
            <div className="relative w-full max-w-lg rounded-lg border border-app surface p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-app">{modalTitle}</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-muted sm:col-span-2">
                  <span className="font-semibold">{t("debts.debtName")}</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span className="font-semibold">{t("debts.amount")}</span>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => updateField("amount", e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span className="font-semibold">{t("debts.currencyLabel")}</span>
                  <select
                    value={form.currency}
                    onChange={(e) => updateField("currency", e.target.value as DebtFormState["currency"])}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted sm:col-span-2">
                  <span className="font-semibold">{t("debts.reason")}</span>
                  <input
                    type="text"
                    value={form.reason}
                    onChange={(e) => updateField("reason", e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span className="font-semibold">{t("debts.dateLabel")}</span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => updateField("date", e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span className="font-semibold">{t("debts.dueDateOptional")}</span>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => updateField("dueDate", e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="space-y-1 text-xs text-muted sm:col-span-2">
                  <span className="font-semibold">{t("debts.notes")}</span>
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                {editingId && (
                  <label className="space-y-1 text-xs text-muted sm:col-span-2">
                    <span className="font-semibold">{t("debts.status")}</span>
                    <select
                      value={form.status}
                      onChange={(e) => updateField("status", e.target.value as DebtFormState["status"])}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(debtStatusTranslationKey(s))}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-app px-4 py-2 text-sm font-semibold text-app"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSaveDebt}
                  disabled={isSaving}
                  className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {isSaving ? t("debts.save") : t("debts.saveIdle")}
                </button>
              </div>
            </div>
          </div>
        )}

        {viewDebt && !("_isSupplier" in viewDebt) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/70" onClick={closeView} />
            <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-app surface p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-app">{viewDebt.name ?? t("debts.debtFallbackName")}</h2>
              <p className="mt-1 text-xs text-muted">
                {viewDebt.type === "receivable" ? t("debts.typeReceivable") : t("debts.typePayable")} •{" "}
                {viewDebt.reason ?? t("common.emiDash")}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">{t("debts.thOriginal")}</span>
                  <p className="font-semibold text-app">{formatMoneyAmt(viewDebt.original_amount, viewDebt.currency ?? "AED")}</p>
                </div>
                <div>
                  <span className="text-gray-400">{t("debts.thPaid")}</span>
                  <p className="font-semibold text-app">{formatMoneyAmt(viewDebt.amount_paid, viewDebt.currency ?? "AED")}</p>
                </div>
                <div>
                  <span className="text-gray-400">{t("debts.thRemaining")}</span>
                  <p className="font-semibold text-[var(--color-accent)]">
                    {formatMoneyAmt(viewDebt.amount_remaining, viewDebt.currency ?? "AED")}
                  </p>
                </div>
                <div>
                  <span className="text-gray-400">{t("debts.thStatus")}</span>
                  <p className="font-semibold text-app">{t(debtStatusTranslationKey(viewDebt.status))}</p>
                </div>
              </div>

              <div className="mt-6 border-t border-app pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("debts.paymentHistoryTitle")}</h3>
                  {(viewDebt.amount_remaining ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsPaymentFormOpen((p) => !p)}
                      className="rounded-md border border-app bg-white px-3 py-1 text-[11px] font-semibold text-app hover:border-[var(--color-accent)]/70"
                    >
                      {isPaymentFormOpen ? t("common.cancel") : t("debts.addPayment")}
                    </button>
                  )}
                </div>

                {isPaymentFormOpen && (viewDebt.amount_remaining ?? 0) > 0 && (
                  <div className="mt-3 rounded-md border border-app bg-white p-3 text-xs">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="font-semibold text-app">{t("debts.paymentAmount")}</span>
                        <input
                          type="number"
                          value={newPaymentAmount}
                          onChange={(e) => setNewPaymentAmount(e.target.value)}
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-app outline-none focus:border-[var(--color-accent)]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-app">{t("debts.paymentDate")}</span>
                        <input
                          type="date"
                          value={newPaymentDate}
                          onChange={(e) => setNewPaymentDate(e.target.value)}
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-app outline-none focus:border-[var(--color-accent)]"
                        />
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <span className="font-semibold text-app">{t("debts.paymentPocket")}</span>
                        <select
                          value={newPaymentPocket}
                          onChange={(e) => setNewPaymentPocket(e.target.value)}
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-app outline-none focus:border-[var(--color-accent)]"
                        >
                          {(POCKETS_BY_CURRENCY[viewDebt.currency ?? "AED"] ?? []).map((p) => (
                            <option key={p} value={p}>
                              {translatePocket(t, p)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <span className="font-semibold text-app">{t("debts.paymentNotes")}</span>
                        <input
                          type="text"
                          value={newPaymentNote}
                          onChange={(e) => setNewPaymentNote(e.target.value)}
                          className="w-full rounded-md border border-app bg-white px-2 py-1 text-app outline-none focus:border-[var(--color-accent)]"
                        />
                      </label>
                    </div>
                    {paymentsError && <p className="mt-2 text-red-300">{paymentsError}</p>}
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddPayment}
                        disabled={isAddingPayment}
                        className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        {isAddingPayment ? t("debts.save") : t("debts.savePayment")}
                      </button>
                    </div>
                  </div>
                )}

                {paymentsLoading ? (
                  <p className="mt-2 text-gray-400">{t("debts.loadingPayments")}</p>
                ) : paymentsError && !isPaymentFormOpen ? (
                  <p className="mt-2 text-red-300">{paymentsError}</p>
                ) : debtPayments.length === 0 ? (
                  <p className="mt-2 text-gray-400">{t("debts.noPaymentsYet")}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {debtPayments.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-app pb-2 text-[11px] last:border-b-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-app">{formatDateDisp(p.date)}</span>
                          <span className="text-app">{formatMoneyAmt(p.amount, p.currency ?? "AED")}</span>
                          <span className="text-gray-400">{translatePocket(t, p.pocket)}</span>
                          {p.notes && <span className="text-gray-400">{p.notes}</span>}
                        </div>
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => handleDeletePayment(p)}
                            disabled={deletingPaymentId === p.id}
                            className="rounded border border-app bg-white px-2 py-0.5 text-[10px] font-semibold text-red-400 hover:border-red-700 disabled:opacity-50"
                          >
                            {deletingPaymentId === p.id ? t("debts.removing") : t("debts.delete")}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={closeView}
                  className="rounded-md border border-app px-4 py-2 text-sm font-semibold text-app"
                >
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        )}
      </PageContainer>
    </div>
  );
}
