"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "@heroui/react";
import dynamic from "next/dynamic";
import type { Movement } from "@/lib/types";
import type { ReceiptPDFData } from "@/lib/pdf/pdfTypes";
import { logActivity } from "@/lib/activity";
import {
  reverseMovementOnCashPosition,
} from "@/lib/finance/applyCashPositionChange";
import { validatePocketForCurrency } from "@/lib/finance/cashPockets";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";
import { formatDateForLocale, formatNumberForLocale, useI18n } from "@/lib/context/I18nContext";
import { pocketDetailLabel } from "@/lib/i18n/enumLabels";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { PageContainer } from "@/components/ui/page-container";

const ReceiptDownloadButton = dynamic(
  () => import("@/components/PDFButtons").then((m) => m.ReceiptDownloadButton),
  { ssr: false }
);

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

const CURRENCIES = ["AED", "DZD", "USD", "EUR"] as const;
const CONVERSION_TO_CURRENCIES = ["AED", "USD", "EUR"] as const;

type CashPosition = {
  id: string;
  pocket: string | null;
  amount: number | null;
  currency: string | null;
};

/** Pockets that have a cash_positions row for the given currency (and pass pocket/currency rules). */
function pocketsHoldingCurrency(
  cashPositions: CashPosition[],
  currency: string
): string[] {
  const c = currency.trim().toUpperCase();
  if (!c) return [];
  const seen = new Set<string>();
  for (const row of cashPositions) {
    if ((row.currency || "").trim().toUpperCase() !== c) continue;
    const pocket = (row.pocket || "").trim();
    if (!pocket || seen.has(pocket)) continue;
    if (validatePocketForCurrency(pocket, c) !== null) continue;
    seen.add(pocket);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

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

function isConversionApproved(legs: Movement[]): boolean {
  const inLeg = legs.some((m) => (m.type || "").toLowerCase() === "in");
  if (inLeg) return true;
  for (const m of legs) {
    const meta = parseConversionMeta(m.description ?? null);
    if (meta?.status === "approved" || meta?.approvedAt) return true;
  }
  return false;
}

/** Legs whose cash_positions were updated and must be reversed before delete. */
function conversionLegsRequiringCashReversal(legs: Movement[]): Movement[] {
  if (!isConversionApproved(legs)) return [];
  return legs.filter((m) => {
    const amount = Number(m.amount || 0);
    if (amount <= 0 || !m.pocket?.trim() || !m.currency?.trim()) return false;
    return true;
  });
}

function reversedPocketLabels(legs: Movement[]): string {
  const names = new Set<string>();
  for (const m of legs) {
    const p = (m.pocket || "").trim();
    if (p) names.add(p);
  }
  return [...names].sort((a, b) => a.localeCompare(b)).join(", ");
}

function conversionDeleteActivityDescription(
  actorLabel: string,
  ref: string,
  legs: Movement[],
  cashLegs: Movement[]
): string {
  const out = legs.find((m) => (m.type || "").toLowerCase() === "out");
  const inLeg = legs.find((m) => (m.type || "").toLowerCase() === "in");
  const meta = parseConversionMeta(out?.description ?? inLeg?.description ?? null);
  const fromAmount = out?.amount ?? 0;
  const fromCurrency = out?.currency ?? "DZD";
  const toAmount = inLeg?.amount ?? meta?.actualAmount ?? meta?.expectedAmount ?? 0;
  const toCurrency = inLeg?.currency ?? meta?.toCurrency ?? "";
  const pockets = reversedPocketLabels(cashLegs);
  const pocketNote = pockets ? `Cash reversed on pockets ${pockets}.` : "No pocket balances were changed.";
  return `${actorLabel} deleted conversion ${ref} (${fromAmount} ${fromCurrency} → ${toAmount} ${toCurrency}). ${pocketNote}`;
}

function exchangeDeleteActivityDescription(
  actorLabel: string,
  ref: string,
  legs: Movement[]
): string {
  const out = legs.find((m) => (m.type || "").toLowerCase() === "out");
  const inLeg = legs.find((m) => (m.type || "").toLowerCase() === "in");
  const fromAmount = out?.amount ?? 0;
  const fromCurrency = out?.currency ?? "";
  const toAmount = inLeg?.amount ?? 0;
  const toCurrency = inLeg?.currency ?? "";
  const pockets = reversedPocketLabels(legs);
  return `${actorLabel} deleted cash exchange ${ref} (${fromAmount} ${fromCurrency} → ${toAmount} ${toCurrency}). Cash reversed on pockets ${pockets}.`;
}

async function reverseCashLegsOrAbort(
  legs: Movement[],
  onError: (message: string) => void
): Promise<boolean> {
  const reversed: Movement[] = [];
  for (const m of legs) {
    const rev = await reverseMovementOnCashPosition(supabase, {
      pocket: m.pocket,
      currency: m.currency,
      amount: m.amount,
      type: m.type,
    });
    if (!rev.ok) {
      for (const prior of reversed) {
        await reverseMovementOnCashPosition(supabase, {
          pocket: prior.pocket,
          currency: prior.currency,
          amount: prior.amount,
          type: prior.type,
        });
      }
      onError(rev.error);
      return false;
    }
    reversed.push(m);
  }
  return true;
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
  receivingPocket: string;
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

function parseNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
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
  const { locale, t } = useI18n();
  const dash = t("common.emiDash");
  const fmtNum = (n: number, options?: Intl.NumberFormatOptions) =>
    formatNumberForLocale(locale, n, { maximumFractionDigits: 0, ...options });
  const fmtMoney = (value: number | null | undefined, currency: string | null | undefined) => {
    const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
    const c = currency || "";
    return `${fmtNum(v)}${c ? ` ${c}` : ""}`;
  };
  const fmtMoneyFine = (value: number, currency: string) =>
    `${formatNumberForLocale(locale, value, { maximumFractionDigits: 2 })} ${currency}`;
  const fmtDate = (value: string | null | undefined) => {
    if (!value) return dash;
    const s = formatDateForLocale(locale, value, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return s || dash;
  };
  const fmtDateTime = (value: string | null | undefined, time?: string) => {
    const base = fmtDate(value);
    if (base === dash) return dash;
    return time ? `${base} ${time}` : base;
  };
  const fmtRate4 = (n: number) =>
    formatNumberForLocale(locale, n, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });

  const { canDelete, profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"conversions" | "exchange">("conversions");
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
  const [pendingReceipt, setPendingReceipt] = useState<ReceiptPDFData | null>(null);

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
        [t("transfers.loadFailed"), cashError?.message, movesError?.message]
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

  const receivingPocketsForConversion = useMemo(
    () => pocketsHoldingCurrency(cashPositions, conversionForm.toCurrency),
    [cashPositions, conversionForm.toCurrency]
  );

  const fromPocketsForExchange = useMemo(
    () => pocketsHoldingCurrency(cashPositions, exchangeForm.fromCurrency),
    [cashPositions, exchangeForm.fromCurrency]
  );

  const toPocketsForExchange = useMemo(
    () =>
      pocketsHoldingCurrency(cashPositions, exchangeForm.toCurrency).filter(
        (p) => p !== exchangeForm.fromPocket
      ),
    [cashPositions, exchangeForm.toCurrency, exchangeForm.fromPocket]
  );

  useEffect(() => {
    setConversionForm((prev) => {
      const pockets = pocketsHoldingCurrency(cashPositions, prev.toCurrency);
      if (pockets.length === 0) {
        return prev.receivingPocket === "" ? prev : { ...prev, receivingPocket: "" };
      }
      if (pockets.includes(prev.receivingPocket)) return prev;
      return { ...prev, receivingPocket: pockets[0]! };
    });
  }, [cashPositions, conversionForm.toCurrency]);

  useEffect(() => {
    setExchangeForm((prev) => {
      const fromPockets = pocketsHoldingCurrency(cashPositions, prev.fromCurrency);
      const toPockets = pocketsHoldingCurrency(cashPositions, prev.toCurrency).filter(
        (p) => p !== prev.fromPocket
      );
      let fromPocket = prev.fromPocket;
      let toPocket = prev.toPocket;
      if (fromPockets.length === 0) {
        fromPocket = "";
      } else if (!fromPockets.includes(fromPocket)) {
        fromPocket = fromPockets[0]!;
      }
      if (toPockets.length === 0) {
        toPocket = "";
      } else if (!toPockets.includes(toPocket)) {
        toPocket = toPockets[0]!;
      }
      if (fromPocket === prev.fromPocket && toPocket === prev.toPocket) return prev;
      return { ...prev, fromPocket, toPocket };
    });
  }, [cashPositions, exchangeForm.fromCurrency, exchangeForm.toCurrency, exchangeForm.fromPocket]);

  const handleSaveConversion = async () => {
    const amountDzd = parseNum(conversionForm.amountDzd);
    const rate = parseNum(conversionForm.rate);
    if (!conversionForm.date || !conversionForm.depositedBy.trim()) {
      setError(t("transfers.dateDepositedByRequired"));
      return;
    }
    if (amountDzd <= 0) {
      setError(t("transfers.amountDzdRequired"));
      return;
    }
    if (rate <= 0) {
      setError(t("transfers.rateRequired"));
      return;
    }
    if (
      !conversionForm.receivingPocket.trim() ||
      !receivingPocketsForConversion.includes(conversionForm.receivingPocket)
    ) {
      setError(t("transfers.noPocketForCurrency", { currency: conversionForm.toCurrency }));
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
      setError([t("transfers.createConversionFailed"), insertErr.message].join(" "));
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
    // Build and show receipt
    const receiptId = txId;
    setPendingReceipt({
      receiptNumber: receiptId,
      date: conversionForm.date,
      time: conversionForm.time,
      type: t("transfers.receiptTypeConversion"),
      rows: [
        { label: t("transfers.receiptFromPocket"), value: pocketDetailLabel(t, conversionForm.fromPocket) },
        { label: t("transfers.receiptAmountSentDzd"), value: `${fmtNum(amountDzd)} DZD`, highlight: true },
        {
          label: t("transfers.receiptExchangeRate"),
          value: t("transfers.receiptRateLine", { toCurrency: conversionForm.toCurrency, rate: conversionForm.rate }),
        },
        {
          label: t("transfers.receiptExpectedAmount"),
          value: fmtMoneyFine(expectedAmount, conversionForm.toCurrency),
          highlight: true,
        },
        { label: t("transfers.receiptReceivingPocket"), value: pocketDetailLabel(t, conversionForm.receivingPocket) },
        { label: t("transfers.receiptStatus"), value: t("transfers.receiptPendingApproval") },
        ...(conversionForm.depositedBy
          ? [{ label: t("transfers.receiptDepositedBy"), value: conversionForm.depositedBy }]
          : []),
      ],
      notes: conversionForm.notes || undefined,
    });
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
      setError(t("transfers.actualAmountDateRequired"));
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
      setError(t("transfers.dateDoneByRequired"));
      return;
    }
    if (fromAmount <= 0 || toAmount <= 0) {
      setError(t("transfers.exchangeAmountsRequired"));
      return;
    }
    if (exchangeForm.fromPocket === exchangeForm.toPocket) {
      setError(t("transfers.pocketsMustDiffer"));
      return;
    }
    if (
      !exchangeForm.fromPocket.trim() ||
      !fromPocketsForExchange.includes(exchangeForm.fromPocket)
    ) {
      setError(t("transfers.noPocketForCurrency", { currency: exchangeForm.fromCurrency }));
      return;
    }
    if (
      !exchangeForm.toPocket.trim() ||
      !toPocketsForExchange.includes(exchangeForm.toPocket)
    ) {
      setError(t("transfers.noPocketForCurrency", { currency: exchangeForm.toCurrency }));
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
      setError([t("transfers.createExchangeFailed"), outErr.message].join(" "));
      setIsSaving(false);
      return;
    }
    const { error: inErr } = await supabase.from("movements").insert(inPayload);
    if (inErr) {
      setError([t("transfers.exchangeInLegFailed"), inErr.message].join(" "));
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
    const capturedRef = ref;
    const capturedForm = { ...exchangeForm };
    setExchangeRefId(null);
    setExchangeForm(emptyExchangeForm());
    await fetchAll();
    // Build and show receipt
    setPendingReceipt({
      receiptNumber: capturedRef,
      date: capturedForm.date,
      type: t("transfers.receiptTypeExchange"),
      rows: [
        { label: t("transfers.receiptFromPocket"), value: pocketDetailLabel(t, capturedForm.fromPocket) },
        {
          label: t("transfers.receiptAmountGiven"),
          value: `${fmtNum(fromAmount)} ${capturedForm.fromCurrency}`,
          highlight: true,
        },
        { label: t("transfers.receiptToPocket"), value: pocketDetailLabel(t, capturedForm.toPocket) },
        {
          label: t("transfers.receiptAmountReceived"),
          value: `${fmtNum(toAmount)} ${capturedForm.toCurrency}`,
          highlight: true,
        },
        ...(capturedForm.doneBy ? [{ label: t("transfers.receiptDoneBy"), value: capturedForm.doneBy }] : []),
      ],
      notes: capturedForm.notes || undefined,
      doneBy: capturedForm.doneBy || undefined,
    });
  };

  const handleDeleteConversion = async (ref: string) => {
    if (!canDelete) return;
    if (
      !window.confirm(t("transfers.deleteConversionConfirm"))
    )
      return;
    setDeletingRef(ref);
    setError(null);
    const legs = movements.filter(
      (m) => m.category === "Conversion" && m.reference === ref
    );
    const cashLegs = conversionLegsRequiringCashReversal(legs);
    const cashOk = await reverseCashLegsOrAbort(cashLegs, (message) => {
      setError([t("transfers.deleteConversionCashFailed"), message].filter(Boolean).join(" "));
    });
    if (!cashOk) {
      setDeletingRef(null);
      return;
    }
    for (const m of legs) {
      const { error: delErr } = await supabase.from("movements").delete().eq("id", m.id);
      if (delErr) {
        setError([t("transfers.deleteConversionFailed"), delErr.message].filter(Boolean).join(" "));
        setDeletingRef(null);
        await fetchAll();
        return;
      }
    }

    const actorLabel =
      profile?.name?.trim() || user?.email?.trim() || t("common.emiDash");
    const outLeg = legs.find((m) => (m.type || "").toLowerCase() === "out");
    await logActivity({
      action: "deleted",
      entity: "conversion",
      entity_id: ref,
      description: conversionDeleteActivityDescription(actorLabel, ref, legs, cashLegs),
      amount: outLeg?.amount ?? null,
      currency: outLeg?.currency ?? "DZD",
      actorName: actorLabel,
    });

    setDeletingRef(null);
    await fetchAll();
  };

  const handleDeleteExchange = async (ref: string) => {
    if (!canDelete) return;
    if (
      !window.confirm(t("transfers.deleteExchangeConfirm"))
    )
      return;
    setDeletingRef(ref);
    setError(null);
    const legs = movements.filter(
      (m) => m.category === "Cash Exchange" && m.reference === ref
    );
    const cashOk = await reverseCashLegsOrAbort(legs, (message) => {
      setError([t("transfers.deleteExchangeCashFailed"), message].filter(Boolean).join(" "));
    });
    if (!cashOk) {
      setDeletingRef(null);
      return;
    }
    for (const m of legs) {
      const { error: delErr } = await supabase.from("movements").delete().eq("id", m.id);
      if (delErr) {
        setError([t("transfers.deleteExchangeFailed"), delErr.message].filter(Boolean).join(" "));
        setDeletingRef(null);
        await fetchAll();
        return;
      }
    }

    const actorLabel =
      profile?.name?.trim() || user?.email?.trim() || t("common.emiDash");
    const outLeg = legs.find((m) => (m.type || "").toLowerCase() === "out");
    await logActivity({
      action: "deleted",
      entity: "cash_exchange",
      entity_id: ref,
      description: exchangeDeleteActivityDescription(actorLabel, ref, legs),
      amount: outLeg?.amount != null ? -Number(outLeg.amount) : null,
      currency: outLeg?.currency ?? null,
      actorName: actorLabel,
    });

    setDeletingRef(null);
    await fetchAll();
  };

  return (
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="xl">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {t("pages.transfers.title")}
            </h1>
            <p className="text-sm font-medium text-danger">
              {t("pages.transfers.subtitle")}
            </p>
          </div>
        </header>

        {/* Dashboard alert: pending conversions */}
        {dashboardAlert.count > 0 && (
          <section className="rounded-lg border border-red-800 bg-red-50 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-red-300">
              {t("transfers.dashboardAlertTitle")}
            </h2>
            <p className="mt-2 text-app">
              {t("transfers.pendingAlert", {
                count: dashboardAlert.count,
                total: fmtMoney(dashboardAlert.totalExpected, dashboardAlert.toCurrency),
              })}
            </p>
          </section>
        )}

        <div className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto overflow-y-visible border-b border-default-200 px-1 pb-2 [overscroll-behavior-x:contain] [scrollbar-width:thin] sm:flex-wrap">
          {(
            [
              { key: "conversions" as const, label: t("transfers.tabConversions") },
              { key: "exchange" as const, label: t("transfers.tabExchange") },
            ] as const
          ).map((tab) => (
            <Button
              key={tab.key}
              type="button"
              size="sm"
              variant={activeTab === tab.key ? "primary" : "outline"}
              onPress={() => setActiveTab(tab.key)}
            >
              {tab.label}
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

        {activeTab === "conversions" && (
          <>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onPress={() => {
                  setConversionForm(emptyConversionForm());
                  setIsConversionModalOpen(true);
                  setError(null);
                }}
              >
                {t("transfers.addConversion")}
              </Button>
            </div>

            <div className="space-y-6">
              {pendingConversions.length > 0 && (
                <div className="rounded-lg border border-app surface">
                  <h3 className="border-b border-app px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("transfers.pendingConversions")}
                  </h3>
                  <div className="responsive-table-wrap">
                    <table className="min-w-[620px] w-full text-left text-xs">
                      <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3">{t("transfers.thTransactionId")}</th>
                          <th className="px-4 py-3">{t("transfers.thDate")}</th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thDepositedBy")}
                          </th>
                          <th className="px-4 py-3">{t("transfers.thAmountDzd")}</th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thRate")}
                          </th>
                          <th className="px-4 py-3">{t("transfers.thExpected")}</th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thReceivingPocket")}
                          </th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thStatus")}
                          </th>
                          <th className="px-4 py-3">{t("transfers.thActions")}</th>
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
                              {fmtDateTime(movement.date, meta.time)}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {meta.depositedBy}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {fmtMoney(movement.amount, "DZD")}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {movement.rate != null
                                ? formatNumberForLocale(locale, Number(movement.rate), {
                                    maximumFractionDigits: 6,
                                  })
                                : dash}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {fmtMoney(meta.expectedAmount, meta.toCurrency)}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {pocketDetailLabel(t, meta.receivingPocket)}
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span className="inline-flex rounded-full bg-red-900/60 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                {t("transfers.statusPending")}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <RowActionsMenu label={t("transfers.pendingConversionActions")}>
                                <button
                                  type="button"
                                  onClick={() => openApprovalModal(movement, meta)}
                                  disabled={approvingRef === ref}
                                  className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-default-700 hover:bg-default-100 disabled:opacity-50"
                                >
                                  {t("transfers.approve")}
                                </button>
                                {canDelete ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteConversion(ref)}
                                    disabled={deletingRef === ref}
                                    className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                                  >
                                    {deletingRef === ref ? t("transfers.deleting") : t("transfers.delete")}
                                  </button>
                                ) : null}
                              </RowActionsMenu>
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
                  {t("transfers.approvedConversions")}
                </h3>
                {approvedConversions.length === 0 ? (
                  <div className="p-4 text-sm text-muted">
                    {t("transfers.noApprovedConversions")}
                  </div>
                ) : (
                  <div className="responsive-table-wrap">
                    <table className="min-w-[620px] w-full text-left text-xs">
                      <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3">{t("transfers.thTransactionId")}</th>
                          <th className="px-4 py-3">{t("transfers.thDate")}</th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thDepositedBy")}
                          </th>
                          <th className="px-4 py-3 hidden sm:table-cell">{t("transfers.thFrom")}</th>
                          <th className="px-4 py-3">{t("transfers.thAmountDzd")}</th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thRate")}
                          </th>
                          <th className="px-4 py-3">{t("transfers.thReceived")}</th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thReceivingPocket")}
                          </th>
                          <th className="px-4 py-3 hidden sm:table-cell">
                            {t("transfers.thStatus")}
                          </th>
                          <th className="px-4 py-3">{t("transfers.thActions")}</th>
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
                              {fmtDateTime(movement.date, meta.time)}
                              {meta.approvedAt && (
                                <span className="ml-1 text-gray-400">
                                  {t("transfers.approvedAt", {
                                    date: fmtDate(meta.approvedAt),
                                  })}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {meta.depositedBy}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {pocketDetailLabel(t, movement.pocket)}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {fmtMoney(movement.amount, "DZD")}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {movement.rate != null
                                ? formatNumberForLocale(locale, Number(movement.rate), {
                                    maximumFractionDigits: 6,
                                  })
                                : dash}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {fmtMoney(
                                meta.actualAmount ?? meta.expectedAmount,
                                meta.toCurrency
                              )}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {pocketDetailLabel(t, meta.receivingPocket)}
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span className="inline-flex rounded-full bg-emerald-900/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                {t("transfers.statusApproved")}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {canDelete ? (
                                <RowActionsMenu label={t("transfers.approvedConversionActions")}>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteConversion(ref)}
                                    disabled={deletingRef === ref}
                                    className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                                  >
                                    {deletingRef === ref ? t("transfers.deleting") : t("transfers.delete")}
                                  </button>
                                </RowActionsMenu>
                              ) : null}
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

        {activeTab === "exchange" && (
          <>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onPress={() => {
                  setExchangeForm(emptyExchangeForm());
                  setExchangeRefId(generateExchangeId());
                  setIsExchangeModalOpen(true);
                  setError(null);
                }}
              >
                {t("transfers.addExchange")}
              </Button>
            </div>
            <div className="rounded-lg border border-app surface">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 p-8 text-default-500">
                  <Spinner size="md" color="danger" />
                  <span className="text-sm">{t("transfers.loadingExchanges")}</span>
                </div>
              ) : exchanges.length === 0 ? (
                <div className="p-4 text-sm text-muted">
                  {t("transfers.noExchanges")}
                </div>
              ) : (
                <div className="responsive-table-wrap">
                  <table className="min-w-[620px] w-full text-left text-xs">
                    <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-4 py-3">{t("transfers.thReferenceId")}</th>
                        <th className="px-4 py-3">{t("transfers.thDate")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">
                          {t("transfers.thDoneBy")}
                        </th>
                        <th className="px-4 py-3">{t("transfers.thFrom")}</th>
                        <th className="px-4 py-3">{t("transfers.thTo")}</th>
                        <th className="px-4 py-3 hidden sm:table-cell">
                          {t("transfers.thRate")}
                        </th>
                        <th className="px-4 py-3">{t("transfers.thActions")}</th>
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
                        let doneBy = dash;
                        if (outLeg?.description) {
                          try {
                            const parsed = JSON.parse(outLeg.description) as { doneBy?: string };
                            doneBy = parsed.doneBy?.trim() ? parsed.doneBy : dash;
                          } catch {
                            doneBy = outLeg.description;
                          }
                        }
                        const fromStr = outLeg
                          ? `${fmtMoney(outLeg.amount, outLeg.currency)} (${pocketDetailLabel(t, outLeg.pocket)})`
                          : dash;
                        const toStr = inLeg
                          ? `${fmtMoney(inLeg.amount, inLeg.currency)} (${pocketDetailLabel(t, inLeg.pocket)})`
                          : dash;
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
                              {fmtDate(ex.date)}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {doneBy}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {fromStr}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {toStr}
                            </td>
                            <td className="px-4 py-3 text-app hidden sm:table-cell">
                              {rate > 0 ? fmtRate4(rate) : dash}
                            </td>
                            <td className="px-4 py-3">
                              {canDelete ? (
                                <RowActionsMenu label={t("transfers.exchangeActions")}>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteExchange(ex.ref)}
                                    disabled={deletingRef === ex.ref}
                                    className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                                  >
                                    {deletingRef === ex.ref ? t("transfers.deleting") : t("transfers.delete")}
                                  </button>
                                </RowActionsMenu>
                              ) : null}
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
      </PageContainer>

      {/* Add Conversion Modal */}
      {isConversionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSaving && setIsConversionModalOpen(false)}
          />
          <div className="relative my-auto flex w-full max-w-2xl max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] min-h-0 flex-col overflow-hidden rounded-lg border border-app surface shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-app px-4 pb-3 pt-4">
              <div>
                <div className="text-lg font-semibold text-app">
                  {t("transfers.modalAddConversionTitle")}
                </div>
                <div className="text-xs text-muted">
                  {t("transfers.modalAddConversionBlurb")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSaving && setIsConversionModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                {t("transfers.close")}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.txIdAuto")}</span>
                <input
                  type="text"
                  readOnly
                  value={generateConversionId(
                    conversionForm.date,
                    conversionForm.time
                  )}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.date")}</span>
                <input
                  type="date"
                  value={conversionForm.date}
                  onChange={(e) =>
                    updateConversionField("date", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.time")}</span>
                <input
                  type="time"
                  value={conversionForm.time}
                  onChange={(e) =>
                    updateConversionField("time", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("transfers.depositedByMandatory")}</span>
                <input
                  type="text"
                  value={conversionForm.depositedBy}
                  onChange={(e) =>
                    updateConversionField("depositedBy", e.target.value)
                  }
                  placeholder={t("transfers.depositedByPlaceholder")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.fromPocket")}</span>
                <select
                  value={conversionForm.fromPocket}
                  onChange={(e) =>
                    updateConversionField(
                      "fromPocket",
                      e.target.value as ConversionFormState["fromPocket"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CONVERSION_FROM_POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {pocketDetailLabel(t, p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.fromCurrency")}</span>
                <input
                  type="text"
                  readOnly
                  value="DZD"
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.amountDzdMandatory")}</span>
                <input
                  type="number"
                  value={conversionForm.amountDzd}
                  onChange={(e) =>
                    updateConversionField("amountDzd", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.toCurrency")}</span>
                <select
                  value={conversionForm.toCurrency}
                  onChange={(e) =>
                    updateConversionField(
                      "toCurrency",
                      e.target.value as ConversionFormState["toCurrency"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CONVERSION_TO_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.rateMandatory")}</span>
                <input
                  type="number"
                  step="any"
                  value={conversionForm.rate}
                  onChange={(e) =>
                    updateConversionField("rate", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.expectedAmountReceive")}</span>
                <input
                  type="text"
                  readOnly
                  value={
                    expectedAmount > 0
                      ? fmtMoney(expectedAmount, conversionForm.toCurrency)
                      : dash
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.receivingPocket")}</span>
                {receivingPocketsForConversion.length === 0 ? (
                  <p className="rounded-md border border-amber-700/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t("transfers.noPocketForCurrency", {
                      currency: conversionForm.toCurrency,
                    })}
                  </p>
                ) : (
                  <select
                    value={conversionForm.receivingPocket}
                    onChange={(e) =>
                      updateConversionField("receivingPocket", e.target.value)
                    }
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    {receivingPocketsForConversion.map((p) => (
                      <option key={p} value={p}>
                        {pocketDetailLabel(t, p)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("transfers.notes")}</span>
                <input
                  type="text"
                  value={conversionForm.notes}
                  onChange={(e) =>
                    updateConversionField("notes", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-app px-4 pb-4 pt-3">
              <button
                type="button"
                onClick={() => !isSaving && setIsConversionModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app bg-white px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                {t("transfers.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveConversion}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSaving ? t("transfers.saving") : t("transfers.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Receipt Modal ─────────────────────────────────────────────── */}
      {pendingReceipt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-4">
          <div className="absolute inset-0 bg-black/75" onClick={() => setPendingReceipt(null)} />
          <div className="relative my-auto flex w-full max-w-sm max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] min-h-0 flex-col overflow-y-auto rounded-xl border border-app surface p-6 shadow-2xl">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-red">
                  {t("transfers.receiptReady")}
                </p>
                <p className="mt-0.5 text-sm font-bold text-primary">#{pendingReceipt.receiptNumber}</p>
              </div>
              <button
                onClick={() => setPendingReceipt(null)}
                className="rounded p-1 text-secondary hover:bg-app transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {/* Summary rows */}
            <div className="mb-4 divide-y divide-app rounded-lg border border-app overflow-hidden">
              {pendingReceipt.rows.slice(0, 4).map((row, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-secondary">{row.label}</span>
                  <span className={`text-xs font-semibold ${row.highlight ? "text-brand-red" : "text-primary"}`}>{row.value}</span>
                </div>
              ))}
            </div>
            {/* Saved confirmation */}
            <p className="mb-4 text-center text-xs text-green-400">{t("transfers.receiptSaved")}</p>
            {/* Buttons */}
            <div className="flex gap-2">
              <ReceiptDownloadButton
                data={pendingReceipt}
                label={t("transfers.downloadReceipt")}
                className="flex-1 rounded border border-brand-red/50 bg-brand-red/10 py-2.5 text-xs font-semibold text-brand-red hover:bg-brand-red/20 transition-colors"
              />
              <button
                onClick={() => setPendingReceipt(null)}
                className="flex-1 rounded border border-app py-2.5 text-xs font-semibold text-secondary hover:bg-app transition-colors"
              >
                {t("transfers.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval Modal */}
      {approvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isApprovalSaving && setApprovalModal(null)}
          />
          <div className="relative my-auto flex w-full max-w-md max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] min-h-0 flex-col overflow-hidden rounded-lg border border-app surface shadow-xl">
            <div className="shrink-0 border-b border-app px-4 pb-3 pt-4 text-lg font-semibold text-app">
              {t("transfers.approveConversionTitle")}
            </div>
            <p className="shrink-0 px-4 pt-2 text-xs text-muted">
              {t("transfers.approveConversionBlurb")}
            </p>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
              <label className="block text-xs text-app">
                <span className="font-semibold">{t("transfers.receivingPocketConfirm")}</span>
                <input
                  type="text"
                  readOnly
                  value={pocketDetailLabel(t, approvalModal.meta.receivingPocket)}
                  className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="block text-xs text-app">
                <span className="font-semibold">{t("transfers.actualAmountReceived")}</span>
                <input
                  type="number"
                  step="any"
                  value={approvalModal.actualAmount}
                  onChange={(e) =>
                    setApprovalModal((prev) =>
                      prev ? { ...prev, actualAmount: e.target.value } : null
                    )
                  }
                  className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="block text-xs text-app">
                <span className="font-semibold">{t("transfers.dateReceived")}</span>
                <input
                  type="date"
                  value={approvalModal.dateReceived}
                  onChange={(e) =>
                    setApprovalModal((prev) =>
                      prev ? { ...prev, dateReceived: e.target.value } : null
                    )
                  }
                  className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-app px-4 pb-4 pt-3">
              <button
                type="button"
                onClick={() => !isApprovalSaving && setApprovalModal(null)}
                disabled={isApprovalSaving}
                className="rounded-md border border-app bg-white px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                {t("transfers.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmApproval}
                disabled={isApprovalSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isApprovalSaving ? t("transfers.confirming") : t("transfers.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Exchange Modal */}
      {isExchangeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !isSaving && setIsExchangeModalOpen(false)}
          />
          <div className="relative my-auto flex w-full max-w-2xl max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] min-h-0 flex-col overflow-hidden rounded-lg border border-app surface shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-app px-4 pb-3 pt-4">
              <div>
                <div className="text-lg font-semibold text-app">
                  {t("transfers.modalAddExchangeTitle")}
                </div>
                <div className="text-xs text-muted">
                  {t("transfers.modalAddExchangeBlurb")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSaving && setIsExchangeModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app px-3 py-1 text-xs font-semibold text-app disabled:opacity-50"
              >
                {t("transfers.close")}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.refIdAuto")}</span>
                <input
                  type="text"
                  readOnly
                  value={exchangeRefId ?? ""}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.date")}</span>
                <input
                  type="date"
                  value={exchangeForm.date}
                  onChange={(e) =>
                    updateExchangeField("date", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("transfers.doneByMandatory")}</span>
                <input
                  type="text"
                  value={exchangeForm.doneBy}
                  onChange={(e) =>
                    updateExchangeField("doneBy", e.target.value)
                  }
                  placeholder={t("transfers.doneByPlaceholder")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.fromCurrency")}</span>
                <select
                  value={exchangeForm.fromCurrency}
                  onChange={(e) =>
                    updateExchangeField(
                      "fromCurrency",
                      e.target.value as ExchangeFormState["fromCurrency"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.fromAmount")}</span>
                <input
                  type="number"
                  value={exchangeForm.fromAmount}
                  onChange={(e) =>
                    updateExchangeField("fromAmount", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.fromPocket")}</span>
                {fromPocketsForExchange.length === 0 ? (
                  <p className="rounded-md border border-amber-700/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t("transfers.noPocketForCurrency", {
                      currency: exchangeForm.fromCurrency,
                    })}
                  </p>
                ) : (
                  <select
                    value={exchangeForm.fromPocket}
                    onChange={(e) =>
                      updateExchangeField(
                        "fromPocket",
                        e.target.value as ExchangeFormState["fromPocket"]
                      )
                    }
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    {fromPocketsForExchange.map((p) => (
                      <option key={p} value={p}>
                        {pocketDetailLabel(t, p)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.toCurrency")}</span>
                <select
                  value={exchangeForm.toCurrency}
                  onChange={(e) =>
                    updateExchangeField(
                      "toCurrency",
                      e.target.value as ExchangeFormState["toCurrency"]
                    )
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
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
                <span className="font-semibold">{t("transfers.toAmount")}</span>
                <input
                  type="number"
                  value={exchangeForm.toAmount}
                  onChange={(e) =>
                    updateExchangeField("toAmount", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.rateAuto")}</span>
                <input
                  type="text"
                  readOnly
                  value={
                    exchangeRate > 0 ? fmtRate4(exchangeRate) : dash
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">{t("transfers.toPocket")}</span>
                {toPocketsForExchange.length === 0 ? (
                  <p className="rounded-md border border-amber-700/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t("transfers.noPocketForCurrency", {
                      currency: exchangeForm.toCurrency,
                    })}
                  </p>
                ) : (
                  <select
                    value={exchangeForm.toPocket}
                    onChange={(e) =>
                      updateExchangeField(
                        "toPocket",
                        e.target.value as ExchangeFormState["toPocket"]
                      )
                    }
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                  >
                    {toPocketsForExchange.map((p) => (
                      <option key={p} value={p}>
                        {pocketDetailLabel(t, p)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">{t("transfers.notes")}</span>
                <input
                  type="text"
                  value={exchangeForm.notes}
                  onChange={(e) =>
                    updateExchangeField("notes", e.target.value)
                  }
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-app px-4 pb-4 pt-3">
              <button
                type="button"
                onClick={() => !isSaving && setIsExchangeModalOpen(false)}
                disabled={isSaving}
                className="rounded-md border border-app bg-white px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
              >
                {t("transfers.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveExchange}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSaving ? t("transfers.saving") : t("transfers.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
