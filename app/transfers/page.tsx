"use client";

import { useEffect, useMemo, useState } from "react";
import type { Movement } from "@/lib/types";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

const POCKETS_ALL = [
  "Dubai Cash",
  "Dubai Bank",
  "Algeria Cash",
  "Algeria Bank",
  "Qatar",
  "EUR Cash",
  "USD Cash",
] as const;

const CONVERSION_FROM_POCKETS = ["Algeria Cash", "Algeria Bank"] as const;
const CONVERSION_RECEIVING_POCKETS = ["Dubai Cash", "Dubai Bank", "Qatar"] as const;

const CURRENCIES = ["AED", "DZD", "USD", "EUR"] as const;
const CONVERSION_TO_CURRENCIES = ["AED", "USD", "EUR"] as const;

type CashPosition = {
  id: string;
  pocket: string | null;
  amount: number | null;
  currency: string | null;
};

type ConversionMeta = {
  depositedBy: string;
  toCurrency: string;
  expectedAmount: number;
  receivingPocket: string;
  time?: string;
  notes?: string;
  status?: "pending" | "approved";
  actualAmount?: number;
  dateReceived?: string;
  approvedAt?: string;
};

function parseConversionMeta(description: string | null): ConversionMeta | null {
  if (!description?.trim()) return null;
  try {
    return JSON.parse(description) as ConversionMeta;
  } catch {
    return null;
  }
}

// ---- Conversion form ----
type ConversionFormState = {
  date: string;
  time: string;
  depositedBy: string;
  fromPocket: (typeof CONVERSION_FROM_POCKETS)[number];
  amountDzd: string;
  toCurrency: (typeof CONVERSION_TO_CURRENCIES)[number];
  rate: string;
  receivingPocket: (typeof CONVERSION_RECEIVING_POCKETS)[number];
  notes: string;
};

const emptyConversionForm = (): ConversionFormState => ({
  date: new Date().toISOString().slice(0, 10),
  time: new Date().toTimeString().slice(0, 5),
  depositedBy: "",
  fromPocket: "Algeria Cash",
  amountDzd: "",
  toCurrency: "AED",
  rate: "",
  receivingPocket: "Dubai Cash",
  notes: "",
});

// ---- Cash Exchange form ----
type ExchangeFormState = {
  date: string;
  doneBy: string;
  fromCurrency: (typeof CURRENCIES)[number];
  fromAmount: string;
  fromPocket: (typeof POCKETS_ALL)[number];
  toCurrency: (typeof CURRENCIES)[number];
  toAmount: string;
  toPocket: (typeof POCKETS_ALL)[number];
  notes: string;
};

const emptyExchangeForm = (): ExchangeFormState => ({
  date: new Date().toISOString().slice(0, 10),
  doneBy: "",
  fromCurrency: "DZD",
  fromAmount: "",
  fromPocket: "Algeria Cash",
  toCurrency: "AED",
  toAmount: "",
  toPocket: "Dubai Cash",
  notes: "",
});

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined
) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const c = currency || "";
  return `${formatNumber(v)}${c ? ` ${c}` : ""}`;
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

function formatDateTime(value: string | null | undefined, time?: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const dateStr = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  if (time) return `${dateStr} ${time}`;
  return dateStr;
}

function generateConversionId(date: string, time: string): string {
  const [y, m, d] = date.split("-");
  const [h = "0", min = "0"] = time.split(":");
  const t = `${h.padStart(2, "0")}${min.padStart(2, "0")}00`;
  return `CNV-${y}${m}${d}-${t}`;
}

function generateExchangeId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `EXC-${y}${m}${d}-${h}${min}${s}`;
}

export default function TransfersPage() {
  const [activeTab, setActiveTab] = useState<"Conversions" | "Cash Exchange">("Conversions");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cashPositions, setCashPositions] = useState<CashPosition[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  const [conversionForm, setConversionForm] = useState<ConversionFormState>(emptyConversionForm());
  const [exchangeForm, setExchangeForm] = useState<ExchangeFormState>(emptyExchangeForm());
  const [isConversionModalOpen, setIsConversionModalOpen] = useState(false);
  const [isExchangeModalOpen, setIsExchangeModalOpen] = useState(false);
  const [exchangeRefId, setExchangeRefId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingRef, setDeletingRef] = useState<string | null>(null);
  const [approvingRef, setApprovingRef] = useState<string | null>(null);

  const [approvalModal, setApprovalModal] = useState<{
    conversion: Movement;
    meta: ConversionMeta;
    actualAmount: string;
    dateReceived: string;
  } | null>(null);
  const [isApprovalSaving, setIsApprovalSaving] = useState(false);

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);
    const [
      { data: cashData, error: cashError },
      { data: movesData, error: movesError },
    ] = await Promise.all([
      supabase.from("cash_positions").select("id, pocket, amount, currency"),
      supabase
        .from("movements")
        .select("*")
        .in("category", ["Conversion", "Cash Exchange"])
        .order("date", { ascending: false }),
    ]);
    if (cashError || movesError) {
      setError(
        ["Failed to load data.", cashError?.message, movesError?.message]
          .filter(Boolean)
          .join(" ")
      );
    }
    setCashPositions((cashData as CashPosition[]) ?? []);
    setMovements((movesData as Movement[]) ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const conversions = useMemo(() => {
    const byRef: Record<string, { movement: Movement; meta: ConversionMeta; ref: string }> = {};
    movements
      .filter(
        (m) =>
          (m.category || "") === "Conversion" &&
          (m.reference || "").startsWith("CNV-")
      )
      .forEach((m) => {
        const meta = parseConversionMeta(m.description ?? null);
        if (!meta) return;
        const ref = m.reference || m.id;
        const existing = byRef[ref];
        const isOut = (m.type || "").toLowerCase() === "out";
        if (!existing || isOut) {
          byRef[ref] = { movement: m, meta, ref };
        }
      });
    return Object.values(byRef).sort(
      (a, b) =>
        new Date(b.movement.date || 0).getTime() -
        new Date(a.movement.date || 0).getTime()
    );
  }, [movements]);

  const pendingConversions = useMemo(
    () =>
      conversions.filter(
        (c) => (c.meta?.status || "") === "pending" && !c.meta?.approvedAt
      ),
    [conversions]
  );

  const approvedConversions = useMemo(
    () =>
      conversions.filter(
        (c) =>
          (c.meta?.status || "") === "approved" || !!c.meta?.approvedAt
      ),
    [conversions]
  );

  const dashboardAlert = useMemo(() => {
    const count = pendingConversions.length;
    const totalExpected = pendingConversions.reduce((sum, c) => {
      return sum + (c.meta?.expectedAmount ?? 0);
    }, 0);
    const toCurrency = pendingConversions[0]?.meta?.toCurrency ?? "AED";
    return { count, totalExpected, toCurrency };
  }, [pendingConversions]);

  const exchanges = useMemo(() => {
    const byRef: Record<string, Movement[]> = {};
    movements
      .filter(
        (m) =>
          (m.category || "") === "Cash Exchange" &&
          (m.reference || "").startsWith("EXC-")
      )
      .forEach((m) => {
        const ref = m.reference || m.id;
        if (!byRef[ref]) byRef[ref] = [];
        byRef[ref].push(m);
      });
    return Object.entries(byRef)
      .map(([ref, legs]) => ({
        ref,
        movements: legs,
        date: legs[0]?.date || "",
      }))
      .sort(
        (a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
      );
  }, [movements]);

  const updateConversionField = <K extends keyof ConversionFormState>(
    key: K,
    value: ConversionFormState[K]
  ) => {
    setConversionForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateExchangeField = <K extends keyof ExchangeFormState>(
    key: K,
    value: ExchangeFormState[K]
  ) => {
    setExchangeForm((prev) => ({ ...prev, [key]: value }));
  };

  const expectedAmount = useMemo(() => {
    const amt = parseNum(conversionForm.amountDzd);
    const r = parseNum(conversionForm.rate);
    if (amt <= 0 || r <= 0) return 0;
    return amt / r;
  }, [conversionForm.amountDzd, conversionForm.rate]);

  const exchangeRate = useMemo(() => {
    const from = parseNum(exchangeForm.fromAmount);
    const to = parseNum(exchangeForm.toAmount);
    if (from <= 0) return 0;
    return to / from;
  }, [exchangeForm.fromAmount, exchangeForm.toAmount]);

  const handleSaveConversion = async () => {
    const amountDzd = parseNum(conversionForm.amountDzd);
    const rate = parseNum(conversionForm.rate);
    if (!conversionForm.date || !conversionForm.depositedBy.trim()) {
      setError("Date and Deposited by are required.");
      return;
    }
    if (amountDzd <= 0) {
      setError("Amount DZD is required and must be greater than 0.");
      return;
    }
    if (rate <= 0) {
      setError("Rate is required and must be greater than 0.");
      return;
    }
    const txId = generateConversionId(conversionForm.date, conversionForm.time);
    const meta: ConversionMeta = {
      depositedBy: conversionForm.depositedBy.trim(),
      toCurrency: conversionForm.toCurrency,
      expectedAmount: amountDzd / rate,
      receivingPocket: conversionForm.receivingPocket,
      time: conversionForm.time,
      notes: conversionForm.notes?.trim() || undefined,
      status: "pending",
    };

    setIsSaving(true);
    setError(null);

    const payload = {
      date: conversionForm.date,
      type: "Out",
      category: "Conversion",
      description: JSON.stringify(meta),
      amount: amountDzd,
      currency: "DZD",
      rate,
      aed_equivalent: null,
      pocket: conversionForm.fromPocket,
      deal_id: null,
      payment_id: null,
      reference: txId,
    };

    const { data: inserted, error: insertErr } = await supabase.from("movements").insert(payload).select("id").single();
    if (insertErr) {
      setError(["Failed to create conversion.", insertErr.message].join(" "));
      setIsSaving(false);
      return;
    }
    const movement = { ...payload, id: inserted?.id, aed_equivalent: undefined, deal_id: undefined, payment_id: undefined } as Movement;
    await logActivity({
      action: "created",
      entity: "conversion",
      entity_id: movement.id,
      description: `Conversion created – ${conversionForm.amountDzd} DZD → ${conversionForm.toCurrency} @ ${conversionForm.rate}`,
      amount: expectedAmount,
      currency: conversionForm.toCurrency,
    });

    // Telegram notification — conversion/transfer created
    fetch("/api/telegram/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "custom",
        data: {
          message: `💱 *New Conversion Created*

💰 ${conversionForm.amountDzd} DZD → ${conversionForm.toCurrency}
📈 Rate: ${conversionForm.rate}
💵 Expected: ${expectedAmount} ${conversionForm.toCurrency}
👛 From: ${conversionForm.fromPocket}
📥 To: ${conversionForm.receivingPocket}`,
        },
      }),
    }).catch(() => {});

    setIsSaving(false);
    setIsConversionModalOpen(false);
    setConversionForm(emptyConversionForm());
    await fetchAll();
  };

  const openApprovalModal = (movement: Movement, meta: ConversionMeta) => {
    setApprovalModal({
      conversion: movement,
      meta,
      actualAmount: String(meta.expectedAmount ?? ""),
      dateReceived: new Date().toISOString().slice(0, 10),
    });
    setError(null);
  };

  const handleConfirmApproval = async () => {
    if (!approvalModal) return;
    const actualAmount = parseNum(approvalModal.actualAmount);
    if (actualAmount <= 0 || !approvalModal.dateReceived) {
      setError("Actual amount and date received are required.");
      return;
    }

    setIsApprovalSaving(true);
    setError(null);

    const { conversion, meta } = approvalModal;
    const ref = conversion.reference || conversion.id;

    const updatedMeta: ConversionMeta = {
      ...meta,
      status: "approved",
      actualAmount,
      dateReceived: approvalModal.dateReceived,
      approvedAt: new Date().toISOString(),
    };

    const { error: updateErr } = await supabase
      .from("movements")
      .update({
        description: JSON.stringify(updatedMeta),
      })
      .eq("id", conversion.id);

    if (updateErr) {
      setError(updateErr.message);
      setIsApprovalSaving(false);
      return;
    }

    const inMovementPayload = {
      date: approvalModal.dateReceived,
      type: "In",
      category: "Conversion",
      amount: actualAmount,
      currency: meta.toCurrency,
      pocket: meta.receivingPocket,
      description: JSON.stringify(updatedMeta),
      rate: null,
      aed_equivalent: null,
      deal_id: null,
      payment_id: null,
      reference: ref,
    };
    const { error: inInsertErr } = await supabase
      .from("movements")
      .insert(inMovementPayload);
    if (inInsertErr) {
      setError(inInsertErr.message);
      setIsApprovalSaving(false);
      return;
    }

    const fromPocket = cashPositions.find(
      (p) =>
        p.pocket === conversion.pocket && (p.currency || "") === "DZD"
    );
    const toPocket = cashPositions.find(
      (p) =>
        p.pocket === meta.receivingPocket &&
        (p.currency || "") === meta.toCurrency
    );

    if (fromPocket) {
      const newFromAmount = (fromPocket.amount || 0) - (conversion.amount || 0);
      await supabase
        .from("cash_positions")
        .update({ amount: newFromAmount })
        .eq("id", fromPocket.id);
    }
    if (toPocket) {
      const newToAmount = (toPocket.amount || 0) + actualAmount;
      await supabase
        .from("cash_positions")
        .update({ amount: newToAmount })
        .eq("id", toPocket.id);
    }

    await logActivity({
      action: "approved",
      entity: "conversion",
      entity_id: conversion.id,
      description: `Conversion approved – ${conversion.amount} DZD → ${actualAmount} ${meta.toCurrency}`,
      amount: actualAmount,
      currency: meta.toCurrency,
    });

    // Telegram notification — conversion approved
    fetch("/api/telegram/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "custom",
        data: {
          message: `✅ *Conversion Approved*

💰 ${conversion.amount} DZD → ${actualAmount} ${meta.toCurrency}
📥 Received in: ${meta.receivingPocket}`,
        },
      }),
    }).catch(() => {});

    setApprovalModal(null);
    setIsApprovalSaving(false);
    await fetchAll();
  };

  const handleSaveExchange = async () => {
    const fromAmount = parseNum(exchangeForm.fromAmount);
    const toAmount = parseNum(exchangeForm.toAmount);
    if (!exchangeForm.date || !exchangeForm.doneBy.trim()) {
      setError("Date and Done by are required.");
      return;
    }
    if (fromAmount <= 0 || toAmount <= 0) {
      setError("From amount and To amount must be greater than 0.");
      return;
    }
    if (exchangeForm.fromPocket === exchangeForm.toPocket) {
      setError("From and To pockets must be different.");
      return;
    }

    const ref = exchangeRefId || generateExchangeId();
    setIsSaving(true);
    setError(null);

    const exchangeMeta = {
      doneBy: exchangeForm.doneBy.trim(),
      notes: exchangeForm.notes?.trim() || undefined,
    };
    const outPayload = {
      date: exchangeForm.date,
      type: "Out",
      category: "Cash Exchange",
      amount: fromAmount,
      currency: exchangeForm.fromCurrency,
      rate: exchangeRate || 1,
      aed_equivalent: null,
      pocket: exchangeForm.fromPocket,
      deal_id: null,
      payment_id: null,
      reference: ref,
      description: JSON.stringify(exchangeMeta),
    };
    const inPayload = {
      date: exchangeForm.date,
      type: "In",
      category: "Cash Exchange",
      amount: toAmount,
      currency: exchangeForm.toCurrency,
      rate: exchangeRate || 1,
      aed_equivalent: null,
      pocket: exchangeForm.toPocket,
      deal_id: null,
      payment_id: null,
      reference: ref,
      description: JSON.stringify(exchangeMeta),
    };

    const { error: outErr } = await supabase.from("movements").insert(outPayload);
    if (outErr) {
      setError(["Failed to create exchange.", outErr.message].join(" "));
      setIsSaving(false);
      return;
    }
    const { error: inErr } = await supabase.from("movements").insert(inPayload);
    if (inErr) {
      setError(["Out leg saved but In failed.", inErr.message].join(" "));
      setIsSaving(false);
      await fetchAll();
      return;
    }

    await logActivity({
      action: "created",
      entity: "conversion",
      entity_id: ref,
      description: `Exchange created – ${fromAmount} ${exchangeForm.fromCurrency} → ${toAmount} ${exchangeForm.toCurrency} (${ref})`,
      amount: toAmount,
      currency: exchangeForm.toCurrency,
    });

    const pocketMap: Record<string, { id: string; amount: number }> = {};
    cashPositions.forEach((p) => {
      const key = `${p.pocket}-${p.currency}`;
      pocketMap[key] = { id: p.id, amount: p.amount || 0 };
    });
    const fromKey = `${exchangeForm.fromPocket}-${exchangeForm.fromCurrency}`;
    const toKey = `${exchangeForm.toPocket}-${exchangeForm.toCurrency}`;
    const fromPos = pocketMap[fromKey];
    const toPos = pocketMap[toKey];
    if (fromPos) {
      await supabase
        .from("cash_positions")
        .update({ amount: fromPos.amount - fromAmount })
        .eq("id", fromPos.id);
    }
    if (toPos) {
      await supabase
        .from("cash_positions")
        .update({ amount: toPos.amount + toAmount })
        .eq("id", toPos.id);
    }

    setIsSaving(false);
    setIsExchangeModalOpen(false);
    setExchangeRefId(null);
    setExchangeForm(emptyExchangeForm());
    await fetchAll();
  };

  const handleDeleteConversion = async (ref: string) => {
    if (
      !window.confirm(
        "Delete this conversion? This cannot be undone."
      )
    )
      return;
    setDeletingRef(ref);
    setError(null);
    const legs = movements.filter(
      (m) => m.category === "Conversion" && m.reference === ref
    );
    for (const m of legs) {
      await supabase.from("movements").delete().eq("id", m.id);
    }
    setDeletingRef(null);
    await fetchAll();
  };

  const handleDeleteExchange = async (ref: string) => {
    if (
      !window.confirm(
        "Delete this exchange? Both movements will be removed."
      )
    )
      return;
    setDeletingRef(ref);
    setError(null);
    const legs = movements.filter(
      (m) => m.category === "Cash Exchange" && m.reference === ref
    );
    for (const m of legs) {
      await supabase.from("movements").delete().eq("id", m.id);
    }
    setDeletingRef(null);
    await fetchAll();
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Transfers
            </h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">
              Conversions &amp; cash exchange
            </p>
          </div>
        </header>

        {/* Dashboard alert: pending conversions */}
        {dashboardAlert.count > 0 && (
          <section className="rounded-lg border border-red-800 bg-red-950/40 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-red-300">
              Dashboard alert
            </h2>
            <p className="mt-2 text-app">
              <span className="font-semibold">{dashboardAlert.count}</span> pending
              conversion{dashboardAlert.count !== 1 ? "s" : ""} — total expected:{" "}
              <span className="font-semibold text-[var(--color-accent)]">
                {formatMoney(dashboardAlert.totalExpected, dashboardAlert.toCurrency)}
              </span>
            </p>
          </section>
        )}

        <div className="flex flex-wrap gap-2 border-b border-app pb-2">
          {(["Conversions", "Cash Exchange"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-app"
                  : "border-app surface text-app hover:border-[var(--color-accent)]/70"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {activeTab === "Conversions" && (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setConversionForm(emptyConversionForm());
                  setIsConversionModalOpen(true);
                  setError(null);
                }}
                className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app hover:opacity-90"
              >
                Add Conversion
              </button>
            </div>

            <div className="space-y-6">
              {pendingConversions.length > 0 && (
                <div className="rounded-lg border border-app surface">
                  <h3 className="border-b border-app px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    Pending conversions
                  </h3>
                  <div className="w-full overflow-x-auto">
                    <table className="min-w-[900px] w-full text-left text-xs">
                      <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3">Transaction ID</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Deposited by</th>
                          <th className="px-4 py-3">Amount DZD</th>
                          <th className="px-4 py-3">Rate</th>
                          <th className="px-4 py-3">Expected</th>
                          <th className="px-4 py-3">Receiving pocket</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingConversions.map(({ movement, meta, ref }) => (
                          <tr
                            key={ref}
                            className="border-b border-app bg-red-950/30 last:border-b-0 border-l-4 border-l-red-600"
                          >
                            <td className="px-4 py-3 font-mono text-app">
                              {ref}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {formatDateTime(movement.date, meta.time)}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {meta.depositedBy}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {formatMoney(movement.amount, "DZD")}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {movement.rate}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {formatMoney(meta.expectedAmount, meta.toCurrency)}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {meta.receivingPocket}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full bg-red-900/60 px-2 py-0.5 text-[11px] font-semibold text-red-200">
                                PENDING
                              </span>
                            </td>
                            <td className="px-4 py-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  openApprovalModal(movement, meta)
                                }
                                disabled={approvingRef === ref}
                                className="rounded-md border border-app bg-[var(--color-accent)] px-3 py-1 text-[11px] font-semibold text-app hover:opacity-90 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteConversion(ref)}
                                disabled={deletingRef === ref}
                                className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-red-700 disabled:opacity-50"
                              >
                                {deletingRef === ref ? "Deleting..." : "Delete"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-app surface">
                <h3 className="border-b border-app px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  Approved conversions
                </h3>
                {approvedConversions.length === 0 ? (
                  <div className="p-4 text-sm text-muted">
                    No approved conversions yet.
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <table className="min-w-[900px] w-full text-left text-xs">
                      <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3">Transaction ID</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Deposited by</th>
                          <th className="px-4 py-3">From</th>
                          <th className="px-4 py-3">Amount DZD</th>
                          <th className="px-4 py-3">Rate</th>
                          <th className="px-4 py-3">Received</th>
                          <th className="px-4 py-3">Receiving pocket</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvedConversions.map(({ movement, meta, ref }) => (
                          <tr
                            key={ref}
                            className="border-b border-app last:border-b-0"
                          >
                            <td className="px-4 py-3 font-mono text-app">
                              {ref}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {formatDateTime(movement.date, meta.time)}
                              {meta.approvedAt && (
                                <span className="ml-1 text-zinc-500">
                                  (approved{" "}
                                  {formatDate(meta.approvedAt)})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {meta.depositedBy}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {movement.pocket}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {formatMoney(movement.amount, "DZD")}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {movement.rate}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {formatMoney(
                                meta.actualAmount ?? meta.expectedAmount,
                                meta.toCurrency
                              )}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {meta.receivingPocket}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full bg-emerald-900/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                APPROVED
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => handleDeleteConversion(ref)}
                                disabled={deletingRef === ref}
                                className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-red-700 disabled:opacity-50"
                              >
                                {deletingRef === ref ? "Deleting..." : "Delete"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === "Cash Exchange" && (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setExchangeForm(emptyExchangeForm());
                  setExchangeRefId(generateExchangeId());
                  setIsExchangeModalOpen(true);
                  setError(null);
                }}
                className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app hover:opacity-90"
              >
                Add Exchange
              </button>
            </div>
            <div className="rounded-lg border border-app surface">
              {isLoading ? (
                <div className="p-4 text-sm text-muted">
                  Loading exchanges...
                </div>
              ) : exchanges.length === 0 ? (
                <div className="p-4 text-sm text-muted">
                  No cash exchanges yet.
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                  <table className="min-w-[900px] w-full text-left text-xs">
                    <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-4 py-3">Reference ID</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Done by</th>
                        <th className="px-4 py-3">From</th>
                        <th className="px-4 py-3">To</th>
                        <th className="px-4 py-3">Rate</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exchanges.map((ex) => {
                        const outLeg = ex.movements.find(
                          (m) => (m.type || "").toLowerCase() === "out"
                        );
                        const inLeg = ex.movements.find(
                          (m) => (m.type || "").toLowerCase() === "in"
                        );
                        let doneBy = "-";
                        if (outLeg?.description) {
                          try {
                            const parsed = JSON.parse(outLeg.description) as { doneBy?: string };
                            doneBy = parsed.doneBy ?? "-";
                          } catch {
                            doneBy = outLeg.description;
                          }
                        }
                        const fromStr = outLeg
                          ? `${formatMoney(outLeg.amount, outLeg.currency)} (${outLeg.pocket})`
                          : "-";
                        const toStr = inLeg
                          ? `${formatMoney(inLeg.amount, inLeg.currency)} (${inLeg.pocket})`
                          : "-";
                        const rate = inLeg?.rate ?? 0;
                        return (
                          <tr
                            key={ex.ref}
                            className="border-b border-app last:border-b-0"
                          >
                            <td className="px-4 py-3 font-mono text-app">
                              {ex.ref}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {formatDate(ex.date)}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {doneBy}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {fromStr}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {toStr}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {rate.toFixed(4)}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => handleDeleteExchange(ex.ref)}
                                disabled={deletingRef === ex.ref}
                                className="rounded-md border border-app bg-black px-3 py-1 text-[11px] font-semibold text-app hover:border-red-700 disabled:opacity-50"
                              >
                                {deletingRef === ex.ref
                                  ? "Deleting..."
                                  : "Delete"}
                              </button>
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
      </div>

      {/* Add Conversion Modal */}
      {isConversionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSaving && setIsConversionModalOpen(false)}
          />
          <div className="relative flex w-full max-w-2xl flex-col overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  Add Conversion
                </div>
                <div className="text-xs text-muted">
                  Cross-border: DZD deposited in Algeria, received in UAE.
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSaving && setIsConversionModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Transaction ID (auto)</span>
                <input
                  type="text"
                  readOnly
                  value={generateConversionId(
                    conversionForm.date,
                    conversionForm.time
                  )}
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Date</span>
                <input
                  type="date"
                  value={conversionForm.date}
                  onChange={(e) =>
                    updateConversionField("date", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Time</span>
                <input
                  type="time"
                  value={conversionForm.time}
                  onChange={(e) =>
                    updateConversionField("time", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Deposited by (mandatory)</span>
                <input
                  type="text"
                  value={conversionForm.depositedBy}
                  onChange={(e) =>
                    updateConversionField("depositedBy", e.target.value)
                  }
                  placeholder="Who gave the cash to the dealer"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">From pocket</span>
                <select
                  value={conversionForm.fromPocket}
                  onChange={(e) =>
                    updateConversionField(
                      "fromPocket",
                      e.target.value as ConversionFormState["fromPocket"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CONVERSION_FROM_POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">From currency</span>
                <input
                  type="text"
                  readOnly
                  value="DZD"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Amount DZD (mandatory)</span>
                <input
                  type="number"
                  value={conversionForm.amountDzd}
                  onChange={(e) =>
                    updateConversionField("amountDzd", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">To currency</span>
                <select
                  value={conversionForm.toCurrency}
                  onChange={(e) =>
                    updateConversionField(
                      "toCurrency",
                      e.target.value as ConversionFormState["toCurrency"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CONVERSION_TO_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Rate (mandatory)</span>
                <input
                  type="number"
                  step="any"
                  value={conversionForm.rate}
                  onChange={(e) =>
                    updateConversionField("rate", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Expected amount to receive</span>
                <input
                  type="text"
                  readOnly
                  value={
                    expectedAmount > 0
                      ? formatMoney(expectedAmount, conversionForm.toCurrency)
                      : "-"
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Receiving pocket</span>
                <select
                  value={conversionForm.receivingPocket}
                  onChange={(e) =>
                    updateConversionField(
                      "receivingPocket",
                      e.target.value as ConversionFormState["receivingPocket"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CONVERSION_RECEIVING_POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Notes</span>
                <input
                  type="text"
                  value={conversionForm.notes}
                  onChange={(e) =>
                    updateConversionField("notes", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-app pt-3">
              <button
                type="button"
                onClick={() => !isSaving && setIsConversionModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app bg-black px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveConversion}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval Modal */}
      {approvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isApprovalSaving && setApprovalModal(null)}
          />
          <div className="relative flex w-full max-w-md flex-col rounded-lg border border-app surface p-4 shadow-xl">
            <div className="border-b border-app pb-3 text-lg font-semibold text-app">
              Approve conversion
            </div>
            <p className="mt-2 text-xs text-muted">
              Confirm actual amount received and date. DZD will be deducted from
              source pocket; received amount will be added to destination.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-app">
                <span className="font-semibold">Receiving pocket (confirm)</span>
                <input
                  type="text"
                  readOnly
                  value={approvalModal.meta.receivingPocket}
                  className="mt-1 w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="block text-xs text-app">
                <span className="font-semibold">Actual amount received</span>
                <input
                  type="number"
                  step="any"
                  value={approvalModal.actualAmount}
                  onChange={(e) =>
                    setApprovalModal((prev) =>
                      prev ? { ...prev, actualAmount: e.target.value } : null
                    )
                  }
                  className="mt-1 w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="block text-xs text-app">
                <span className="font-semibold">Date received</span>
                <input
                  type="date"
                  value={approvalModal.dateReceived}
                  onChange={(e) =>
                    setApprovalModal((prev) =>
                      prev ? { ...prev, dateReceived: e.target.value } : null
                    )
                  }
                  className="mt-1 w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-app pt-3">
              <button
                type="button"
                onClick={() => !isApprovalSaving && setApprovalModal(null)}
                disabled={isApprovalSaving}
                className="rounded-md border border-app bg-black px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApproval}
                disabled={isApprovalSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                {isApprovalSaving ? "Confirming..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Exchange Modal */}
      {isExchangeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSaving && setIsExchangeModalOpen(false)}
          />
          <div className="relative flex w-full max-w-2xl flex-col overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-app pb-3">
              <div>
                <div className="text-lg font-semibold text-app">
                  Add Cash Exchange
                </div>
                <div className="text-xs text-muted">
                  Physical cash exchange, single step.
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSaving && setIsExchangeModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Reference ID (auto)</span>
                <input
                  type="text"
                  readOnly
                  value={exchangeRefId ?? ""}
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Date</span>
                <input
                  type="date"
                  value={exchangeForm.date}
                  onChange={(e) =>
                    updateExchangeField("date", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Done by (mandatory)</span>
                <input
                  type="text"
                  value={exchangeForm.doneBy}
                  onChange={(e) =>
                    updateExchangeField("doneBy", e.target.value)
                  }
                  placeholder="Who did the exchange"
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">From currency</span>
                <select
                  value={exchangeForm.fromCurrency}
                  onChange={(e) =>
                    updateExchangeField(
                      "fromCurrency",
                      e.target.value as ExchangeFormState["fromCurrency"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">From amount</span>
                <input
                  type="number"
                  value={exchangeForm.fromAmount}
                  onChange={(e) =>
                    updateExchangeField("fromAmount", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">From pocket</span>
                <select
                  value={exchangeForm.fromPocket}
                  onChange={(e) =>
                    updateExchangeField(
                      "fromPocket",
                      e.target.value as ExchangeFormState["fromPocket"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {POCKETS_ALL.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">To currency</span>
                <select
                  value={exchangeForm.toCurrency}
                  onChange={(e) =>
                    updateExchangeField(
                      "toCurrency",
                      e.target.value as ExchangeFormState["toCurrency"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CURRENCIES.filter((c) => c !== exchangeForm.fromCurrency).map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    )
                  )}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">To amount</span>
                <input
                  type="number"
                  value={exchangeForm.toAmount}
                  onChange={(e) =>
                    updateExchangeField("toAmount", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Rate (auto)</span>
                <input
                  type="text"
                  readOnly
                  value={
                    exchangeRate > 0 ? exchangeRate.toFixed(4) : "-"
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">To pocket</span>
                <select
                  value={exchangeForm.toPocket}
                  onChange={(e) =>
                    updateExchangeField(
                      "toPocket",
                      e.target.value as ExchangeFormState["toPocket"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {POCKETS_ALL.filter((p) => p !== exchangeForm.fromPocket).map(
                    (p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    )
                  )}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Notes</span>
                <input
                  type="text"
                  value={exchangeForm.notes}
                  onChange={(e) =>
                    updateExchangeField("notes", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-[#0a0a0a] px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-app pt-3">
              <button
                type="button"
                onClick={() => !isSaving && setIsExchangeModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app bg-black px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveExchange}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
