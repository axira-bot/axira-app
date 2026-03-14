/*
  SQL to add EUR and USD cash pockets in Supabase (run in SQL Editor):

  INSERT INTO cash_positions (pocket, currency, amount)
  VALUES
    ('EUR Cash', 'EUR', 0),
    ('USD Cash', 'USD', 0);
*/

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Car, Deal, Movement, Rent } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";

type CashPosition = {
  id: string;
  name?: string | null;
  pocket_name?: string | null;
  pocket?: string | null;
  label?: string | null;
  amount: number;
  currency: string;
};

type Container = {
  id: string;
  shipping_paid: boolean | null;
};

type Commission = {
  id: string;
  amount: number | null;
  status: string | null;
};

type RateKey = "rate_DZD" | "rate_EUR" | "rate_USD" | "rate_GBP";

type RateInfo = {
  value: number;
  updatedAt: string | null;
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function formatCurrency(value: number, currency: string): string {
  return `${formatNumber(value)} ${currency}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min !== 1 ? "s" : ""} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr !== 1 ? "s" : ""} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day !== 1 ? "s" : ""} ago`;
  const week = Math.floor(day / 7);
  if (week < 4) return `${week} week${week !== 1 ? "s" : ""} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month !== 1 ? "s" : ""} ago`;
  const year = Math.floor(day / 365);
  return `${year} year${year !== 1 ? "s" : ""} ago`;
}

function StaffBlurGate({
  children,
  show,
}: {
  children: React.ReactNode;
  show: boolean;
}) {
  if (!show) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-[6px]">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-[#0a0a0a]/80">
        <span className="text-sm font-medium text-zinc-400">
          Managers &amp; Owners Only
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { role } = useAuth();
  const isStaff = role === "staff";

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cashPositions, setCashPositions] = useState<CashPosition[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [conversionMovements, setConversionMovements] = useState<
    Pick<Movement, "id" | "category" | "type" | "reference" | "description">[]
  >([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [rents, setRents] = useState<Rent[]>([]);
  const [rentPaymentRefsThisYear, setRentPaymentRefsThisYear] = useState<string[]>([]);
  type ActivityLogItem = { id: string; description: string; amount: number | null; currency: string | null; created_at: string; entity: string };
  const [recentActivity, setRecentActivity] = useState<ActivityLogItem[]>([]);
  const [rates, setRates] = useState<Record<RateKey, RateInfo>>({
    rate_DZD: { value: 0, updatedAt: null },
    rate_EUR: { value: 0, updatedAt: null },
    rate_USD: { value: 0, updatedAt: null },
    rate_GBP: { value: 0, updatedAt: null },
  });
  const [editingRateKey, setEditingRateKey] = useState<RateKey | null>(null);
  const [editingRateValue, setEditingRateValue] = useState<string>("");
  const [lastSavedRateKey, setLastSavedRateKey] = useState<RateKey | null>(null);

  const [editingPocketId, setEditingPocketId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState<string>("");
  const [updatingPocketId, setUpdatingPocketId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      const [
        { data: cashPositionsData, error: cashPositionsError },
        { data: dealsData, error: dealsError },
        { data: carsData, error: carsError },
        { data: movementsData, error: movementsError },
        { data: recentActivityData, error: recentActivityError },
        { data: containersData, error: containersError },
        { data: conversionData, error: conversionError },
        { data: commissionsData, error: commissionsError },
        { data: rentsData, error: rentsError },
        { data: rentPaymentsData, error: rentPaymentsError },
        { data: appSettingsData, error: appSettingsError },
      ] = await Promise.all([
        supabase.from("cash_positions").select("*"),
        supabase.from("deals").select("*").order("date", { ascending: false }),
        supabase.from("cars").select("*"),
        supabase
          .from("movements")
          .select("*")
          .order("date", { ascending: false })
          .limit(5),
        supabase
          .from("activity_log")
          .select("id, description, amount, currency, created_at, entity")
          .order("created_at", { ascending: false })
          .limit(3),
        supabase.from("containers").select("id, shipping_paid"),
        supabase
          .from("movements")
          .select("id, category, type, reference, description")
          .eq("category", "Conversion")
          .like("reference", "CNV-%"),
        supabase.from("commissions").select("id, amount, status"),
        supabase.from("rents").select("*").eq("status", "active"),
        (() => {
          const y = new Date().getFullYear();
          return supabase
            .from("movements")
            .select("reference")
            .eq("category", "Rent")
            .like("reference", "rent:%")
            .gte("date", `${y}-01-01`)
            .lte("date", `${y}-12-31`);
        })(),
        supabase
          .from("app_settings")
          .select("key, value, updated_at")
          .in("key", ["rate_DZD", "rate_EUR", "rate_USD", "rate_GBP"]),
      ]);

      if (
        cashPositionsError ||
        dealsError ||
        carsError ||
        movementsError ||
        containersError ||
        conversionError ||
        commissionsError ||
        rentsError ||
        rentPaymentsError ||
        appSettingsError ||
        recentActivityError
      ) {
        setError("Some dashboard data failed to load.");
      }

      setCashPositions(cashPositionsData ?? []);
      setDeals(dealsData ?? []);
      setCars(carsData ?? []);
      setMovements(movementsData ?? []);
      setContainers(containersData ?? []);
      setConversionMovements(conversionData ?? []);
      setCommissions((commissionsData as Commission[]) ?? []);
      setRents((rentsData as Rent[]) ?? []);
      setRecentActivity((recentActivityData as ActivityLogItem[]) ?? []);
      setRentPaymentRefsThisYear(
        ((rentPaymentsData as { reference: string }[]) ?? []).map((row) => row.reference || "").filter(Boolean)
      );

      if (appSettingsData) {
        const next: Record<RateKey, RateInfo> = {
          rate_DZD: { value: 0, updatedAt: null },
          rate_EUR: { value: 0, updatedAt: null },
          rate_USD: { value: 0, updatedAt: null },
          rate_GBP: { value: 0, updatedAt: null },
        };
        for (const row of appSettingsData as {
          key: string;
          value: string | null;
          updated_at: string | null;
        }[]) {
          if (
            row.key === "rate_DZD" ||
            row.key === "rate_EUR" ||
            row.key === "rate_USD" ||
            row.key === "rate_GBP"
          ) {
            const num = Number(row.value ?? "0");
            next[row.key] = {
              value: Number.isFinite(num) ? num : 0,
              updatedAt: row.updated_at,
            };
          }
        }
        setRates(next);
      }

      setIsLoading(false);
    };

    fetchData();
  }, []);

  const totalAed = cashPositions
    .filter((p) => p.currency === "AED")
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const totalDzd = cashPositions
    .filter((p) => p.currency === "DZD")
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const realisedProfitAed = deals
    .filter((d) => d.status === "closed")
    .reduce((sum, d) => sum + (d.profit || 0), 0);

  const pendingRevenueDzd = deals.reduce(
    (sum, d) => sum + (d.pending_dzd || 0),
    0
  );

  const carsInDubai = cars.filter(
    (c) => c.location === "Dubai" && c.status === "available"
  ).length;

  const carsInAlgeria = cars.filter(
    (c) => c.location === "Algeria" && c.status === "available"
  ).length;

  const carsInTransit = cars.filter((c) => c.location === "In Transit").length;

  const totalAvailableCars = cars.filter(
    (c) => c.status === "available"
  ).length;

  const dealsWithPending = deals.filter((d) => (d.pending_dzd || 0) > 0);
  const pendingClientPaymentsCount = dealsWithPending.length;
  const pendingClientPaymentsTotal = dealsWithPending.reduce(
    (s, d) => s + (d.pending_dzd || 0),
    0
  );
  const unpaidShippingCount = containers.filter(
    (c) => !c.shipping_paid
  ).length;
  const supplierDebtTotal = cars
    .filter((c) => (c.supplier_owed || 0) > 0)
    .reduce((s, c) => s + (c.supplier_owed || 0), 0);
  const pendingConversionsCount = conversionMovements.filter((m) => {
    if ((m.type || "").toLowerCase() !== "out") return false;
    try {
      const meta = m.description ? JSON.parse(m.description) : {};
      return (meta.status || "") === "pending" && !meta.approvedAt;
    } catch {
      return false;
    }
  }).length;

  const pendingCommissionTotal = commissions
    .filter((c) => (c.status || "").toLowerCase() === "pending")
    .reduce((s, c) => s + (c.amount ?? 0), 0);

  const nextRentDue = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const paidThisYearIds = new Set<string>();
    for (const ref of rentPaymentRefsThisYear) {
      const parts = ref.split(":");
      if (parts[0] === "rent" && parts[1] && parts[2] && parseInt(parts[2], 10) === currentYear) {
        paidThisYearIds.add(parts[1]);
      }
    }

    let nextUnpaid: { date: Date; amount: number; description: string; currency: string } | null = null;
    let nextPaid: { date: Date; amount: number; description: string; currency: string } | null = null;

    for (const r of rents) {
      if ((r.status || "").toLowerCase() !== "active") continue;
      if (r.end_date && new Date(r.end_date) < today) continue;
      const start = new Date(r.start_date);
      const amount = r.annual_amount || 0;
      const paidThisYear = paidThisYearIds.has(r.id);

      if (paidThisYear) {
        const nextYearDate = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
        if (!nextPaid || nextYearDate < nextPaid.date) {
          nextPaid = {
            date: nextYearDate,
            amount,
            description: r.description || "Rent",
            currency: r.currency || "AED",
          };
        }
      } else {
        const dueThisYear = new Date(currentYear, start.getMonth(), start.getDate());
        const dueDate = dueThisYear >= today ? dueThisYear : today;
        if (!nextUnpaid || dueDate < nextUnpaid.date) {
          nextUnpaid = {
            date: dueDate,
            amount,
            description: r.description || "Rent",
            currency: r.currency || "AED",
          };
        }
      }
    }

    if (nextUnpaid) {
      return { ...nextUnpaid, paidThisYear: false };
    }
    if (nextPaid) {
      return { ...nextPaid, paidThisYear: true };
    }
    return null;
  })();

  const recentDeals = deals.slice(0, 5);

  const handleStartEditRate = (key: RateKey) => {
    setEditingRateKey(key);
    setEditingRateValue(
      rates[key].value > 0 ? String(rates[key].value) : ""
    );
  };

  const handleCancelEditRate = () => {
    setEditingRateKey(null);
    setEditingRateValue("");
  };

  const handleSaveRate = async () => {
    if (!editingRateKey) return;
    const value = Number(editingRateValue);
    if (!Number.isFinite(value) || value < 0) {
      setError("Rate must be a non-negative number.");
      return;
    }

    const { data, error: saveError } = await supabase
      .from("app_settings")
      .upsert(
        {
          key: editingRateKey,
          value: String(value),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      )
      .select("key, value, updated_at")
      .single();

    if (saveError) {
      setError("Failed to save rate.");
      return;
    }

    const row = data as { key: RateKey; value: string | null; updated_at: string | null };
    const num = Number(row.value ?? "0");
    setRates((prev) => ({
      ...prev,
      [row.key]: {
        value: Number.isFinite(num) ? num : 0,
        updatedAt: row.updated_at,
      },
    }));

    setLastSavedRateKey(row.key);
    setEditingRateKey(null);
    setEditingRateValue("");
  };

  const handleStartEdit = (pocket: CashPosition) => {
    if (editingPocketId === pocket.id) return;
    setEditingPocketId(pocket.id);
    setEditingAmount(pocket.amount.toString());
  };

  const handleCancelEdit = () => {
    setEditingPocketId(null);
    setEditingAmount("");
  };

  const handleSaveEdit = async () => {
    if (!editingPocketId) return;

    const value = parseFloat(editingAmount);
    if (Number.isNaN(value)) {
      return;
    }

    setUpdatingPocketId(editingPocketId);

    const { error: updateError } = await supabase
      .from("cash_positions")
      .update({ amount: value })
      .eq("id", editingPocketId);

    if (updateError) {
      setError("Failed to update cash position.");
      setUpdatingPocketId(null);
      return;
    }

    setCashPositions((prev) =>
      prev.map((p) =>
        p.id === editingPocketId ? { ...p, amount: value } : p
      )
    );

    setUpdatingPocketId(null);
    setEditingPocketId(null);
    setEditingAmount("");
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 md:px-8">
        {/* Currency Rates */}
        <StaffBlurGate show={isStaff}>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Currency Rates (display only)
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "DZD/AED", key: "rate_DZD" as RateKey },
              { label: "EUR/AED", key: "rate_EUR" as RateKey },
              { label: "USD/AED", key: "rate_USD" as RateKey },
              { label: "GBP/AED", key: "rate_GBP" as RateKey },
            ].map(({ label, key }) => {
              const info = rates[key];
              const isEditing = editingRateKey === key;
              const justSaved = lastSavedRateKey === key;
              return (
                <div
                  key={label}
                  className="rounded-lg border border-[#222222] bg-[#111111] p-4 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      {label}
                    </div>
                    {justSaved && (
                      <div className="text-[11px] text-emerald-400 font-medium">
                        Saved ✓
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        autoFocus
                        value={editingRateValue}
                        onChange={(e) => setEditingRateValue(e.target.value)}
                        className="mr-2 w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-2 py-1 text-sm text-white"
                      />
                    ) : (
                      <span className="text-xl font-semibold text-white">
                        {info.value > 0 ? info.value : "—"}
                      </span>
                    )}
                    {isEditing ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={handleSaveRate}
                          className="rounded-md bg-[#c0392b] px-2 py-1 text-xs font-medium text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEditRate}
                          className="rounded-md border border-[#222222] px-2 py-1 text-xs font-medium text-zinc-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStartEditRate(key)}
                        className="rounded-md border border-[#222222] px-2 py-1 text-xs font-medium text-zinc-200 hover:border-[#c0392b] hover:text-[#c0392b]"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Last updated:{" "}
                    {info.updatedAt ? formatDate(info.updatedAt) : "—"}
                  </div>
                </div>
              );
            })}
            </div>
          </section>
        </StaffBlurGate>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Axira Trading FZE
          </h1>
          <p className="text-sm font-medium text-[#c0392b]">Dashboard</p>
        </header>

        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-lg border border-[#222222] bg-[#111111] p-6 text-sm text-zinc-400">
            Loading dashboard data...
          </div>
        ) : (
          <>
            {/* Section 1 - Top stats */}
            <StaffBlurGate show={isStaff}>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Overview
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Total AED
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatCurrency(totalAed || 0, "AED")}
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Total DZD
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatCurrency(totalDzd || 0, "DZD")}
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Realised Profit AED
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[#c0392b]">
                    {formatCurrency(realisedProfitAed || 0, "AED")}
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Pending Revenue DZD
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatCurrency(pendingRevenueDzd || 0, "DZD")}
                  </div>
                </div>
                </div>
              </section>
            </StaffBlurGate>

            {/* Pending Items */}
            {(pendingClientPaymentsCount > 0 ||
              unpaidShippingCount > 0 ||
              supplierDebtTotal > 0 ||
              pendingConversionsCount > 0 ||
              pendingCommissionTotal > 0 ||
              nextRentDue) && (
              <StaffBlurGate show={isStaff}>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Pending Items
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {pendingClientPaymentsCount > 0 && (
                    <Link
                      href="/deals"
                      className="rounded-lg border border-amber-800 bg-amber-950/50 p-4 text-left transition hover:border-amber-600 hover:bg-amber-950/70"
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-amber-200">
                        Pending Client Payments
                      </div>
                      <div className="mt-2 text-xl font-semibold text-amber-100">
                        {pendingClientPaymentsCount} deal{pendingClientPaymentsCount !== 1 ? "s" : ""}
                      </div>
                      <div className="mt-1 text-sm text-amber-200/90">
                        {formatCurrency(pendingClientPaymentsTotal, "DZD")} total
                      </div>
                    </Link>
                  )}
                  {unpaidShippingCount > 0 && (
                    <Link
                      href="/containers"
                      className="rounded-lg border border-amber-800 bg-amber-950/50 p-4 text-left transition hover:border-amber-600 hover:bg-amber-950/70"
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-amber-200">
                        Unpaid Shipping
                      </div>
                      <div className="mt-2 text-xl font-semibold text-amber-100">
                        {unpaidShippingCount} container{unpaidShippingCount !== 1 ? "s" : ""}
                      </div>
                    </Link>
                  )}
                  {supplierDebtTotal > 0 && (
                    <Link
                      href="/inventory"
                      className="rounded-lg border border-amber-800 bg-amber-950/50 p-4 text-left transition hover:border-amber-600 hover:bg-amber-950/70"
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-amber-200">
                        Supplier Debt
                      </div>
                      <div className="mt-2 text-xl font-semibold text-amber-100">
                        {formatCurrency(supplierDebtTotal, "AED")}
                      </div>
                    </Link>
                  )}
                  {pendingCommissionTotal > 0 && (
                    <Link
                      href="/employees"
                      className="rounded-lg border border-amber-800 bg-amber-950/50 p-4 text-left transition hover:border-amber-600 hover:bg-amber-950/70"
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-amber-200">
                        Unpaid Commissions
                      </div>
                      <div className="mt-2 text-xl font-semibold text-amber-100">
                        {formatCurrency(pendingCommissionTotal, "DZD")}
                      </div>
                      <div className="mt-1 text-sm text-amber-200/90">
                        View employees &amp; commissions
                      </div>
                    </Link>
                  )}
                  {pendingConversionsCount > 0 && (
                    <Link
                      href="/transfers"
                      className="rounded-lg border border-amber-800 bg-amber-950/50 p-4 text-left transition hover:border-amber-600 hover:bg-amber-950/70"
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-amber-200">
                        Pending Conversions
                      </div>
                      <div className="mt-2 text-xl font-semibold text-amber-100">
                        {pendingConversionsCount} conversion{pendingConversionsCount !== 1 ? "s" : ""}
                      </div>
                    </Link>
                  )}
                  {nextRentDue && (
                    <Link
                      href="/movements"
                      className={
                        nextRentDue.paidThisYear
                          ? "rounded-lg border border-[#222222] bg-[#111111] p-4 text-left transition hover:border-zinc-600"
                          : "rounded-lg border border-amber-800 bg-amber-950/50 p-4 text-left transition hover:border-amber-600 hover:bg-amber-950/70"
                      }
                    >
                      <div
                        className={
                          nextRentDue.paidThisYear
                            ? "text-xs font-medium uppercase tracking-wide text-zinc-400"
                            : "text-xs font-medium uppercase tracking-wide text-amber-200"
                        }
                      >
                        {nextRentDue.paidThisYear
                          ? "Rent – Paid"
                          : "Next Rent Due"}
                      </div>
                      <div
                        className={
                          nextRentDue.paidThisYear
                            ? "mt-2 text-xl font-semibold text-zinc-200"
                            : "mt-2 text-xl font-semibold text-amber-100"
                        }
                      >
                        {nextRentDue.paidThisYear
                          ? `Next due: ${formatDate(nextRentDue.date.toISOString())}`
                          : formatCurrency(nextRentDue.amount, nextRentDue.currency)}
                      </div>
                      <div
                        className={
                          nextRentDue.paidThisYear
                            ? "mt-1 text-sm text-zinc-500"
                            : "mt-1 text-sm text-amber-200/90"
                        }
                      >
                        {nextRentDue.paidThisYear
                          ? `${nextRentDue.description} · ${formatCurrency(nextRentDue.amount, nextRentDue.currency)}/year`
                          : `${nextRentDue.description} · ${formatDate(nextRentDue.date.toISOString())}`}
                      </div>
                    </Link>
                  )}
                </div>
              </section>
              </StaffBlurGate>
            )}

            {/* Activity Log */}
            <StaffBlurGate show={isStaff}>
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                    Activity
                  </h2>
                <Link
                  href="/activity"
                  className="text-xs font-medium text-[#c0392b] hover:underline"
                >
                  View All
                </Link>
              </div>
              <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                {recentActivity.length === 0 ? (
                  <div className="text-sm text-zinc-400">No recent activity.</div>
                ) : (
                  <ul className="space-y-3 text-xs">
                    {recentActivity.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-3 border-b border-[#222222] pb-3 last:border-b-0 last:pb-0"
                      >
                        <span className="rounded-full border border-[#333] bg-[#1a1a1a] px-2 py-0.5 text-[11px] font-medium text-zinc-400 shrink-0">
                          {a.entity}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-zinc-200">{a.description}</span>
                          {a.amount != null && a.currency && (
                            <span className="ml-2 text-zinc-400">
                              {formatCurrency(a.amount, a.currency)}
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 text-[11px] text-zinc-500">
                          {timeAgo(a.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                </div>
              </section>
            </StaffBlurGate>

            {/* Section 2 - Cash Positions */}
            <StaffBlurGate show={isStaff}>
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                    Cash Positions
                  </h2>
                </div>

              {cashPositions.length === 0 ? (
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4 text-sm text-zinc-400">
                  No cash positions yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {cashPositions.map((pocket) => (
                    (() => {
                      const pocketName =
                        pocket.name ||
                        pocket.pocket_name ||
                        pocket.pocket ||
                        pocket.label ||
                        "Pocket";

                      return (
                    <div
                      key={pocket.id}
                      className="rounded-lg border border-[#222222] bg-[#111111] p-4 text-sm transition hover:border-[#c0392b]/70"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleStartEdit(pocket)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleStartEdit(pocket);
                        }
                      }}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                        {pocketName}
                      </div>

                      {editingPocketId === pocket.id ? (
                        <div className="mt-3 space-y-2">
                          <input
                            type="number"
                            value={editingAmount}
                            onChange={(e) =>
                              setEditingAmount(e.target.value)
                            }
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded-md border border-[#222222] bg-[#0a0a0a] px-2 py-1 text-xs text-white outline-none focus:border-[#c0392b] focus:ring-1 focus:ring-[#c0392b]"
                          />
                          <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              disabled={updatingPocketId === pocket.id}
                              className="flex-1 rounded-md bg-[#c0392b] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              {updatingPocketId === pocket.id
                                ? "Saving..."
                                : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              className="flex-1 rounded-md border border-[#222222] px-2 py-1 text-xs font-medium text-zinc-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-lg font-semibold">
                          {formatNumber(pocket.amount || 0)}{" "}
                          <span className="text-xs font-normal text-zinc-400">
                            {pocket.currency}
                          </span>
                        </div>
                      )}
                    </div>
                      );
                    })()
                  ))}
                </div>
              )}
              </section>
            </StaffBlurGate>

            {/* Section 3 - Inventory */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Inventory
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Cars in Dubai
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatNumber(carsInDubai || 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Cars in Algeria
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatNumber(carsInAlgeria || 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Cars in Transit
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatNumber(carsInTransit || 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Total Cars (Available)
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatNumber(totalAvailableCars || 0)}
                  </div>
                </div>
              </div>
            </section>

            {/* Section 4 - Recent Deals & Movements */}
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Recent Deals
                </h2>
                <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                  {recentDeals.length === 0 ? (
                    <div className="text-sm text-zinc-400">
                      No deals yet.
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      {recentDeals.map((deal) => (
                        <div
                          key={deal.id}
                          className="flex flex-col gap-1 border-b border-[#222222] pb-3 last:border-b-0 last:pb-0"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              {deal.client_name ?? "Unknown client"}
                            </span>
                            <span className="text-[10px] text-zinc-400">
                              {formatDate(deal.date ?? deal.created_at)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-300">
                            <span>{deal.car_label ?? "Car"}</span>
                            <span>
                              Sale:{" "}
                              <span className="font-semibold">
                                {formatCurrency(deal.sale_dzd || 0, "DZD")}
                              </span>
                            </span>
                            <span>
                              Profit:{" "}
                              <span className="font-semibold text-[#c0392b]">
                                {formatCurrency(deal.profit || 0, "AED")}
                              </span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <StaffBlurGate show={isStaff}>
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                    Recent Movements
                  </h2>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    {movements.length === 0 ? (
                      <div className="text-sm text-zinc-400">
                        No movements yet.
                      </div>
                    ) : (
                      <div className="space-y-3 text-xs">
                        {movements.map((movement) => (
                          <div
                            key={movement.id}
                            className="flex flex-col gap-1 border-b border-[#222222] pb-3 last:border-b-0 last:pb-0"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">
                                {movement.category}
                              </span>
                              <span className="text-[10px] text-zinc-400">
                                {formatDate(movement.date ?? movement.created_at)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
                              <span>
                                {formatCurrency(movement.amount || 0, movement.currency ?? "AED")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </StaffBlurGate>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

