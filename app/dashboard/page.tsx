/*
  SQL to add EUR and USD cash pockets in Supabase (run in SQL Editor):

  INSERT INTO cash_positions (pocket, currency, amount)
  VALUES
    ('EUR Cash', 'EUR', 0),
    ('USD Cash', 'USD', 0);
*/

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Spinner } from "@heroui/react";
import type { Car, Deal, Movement, Rent } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/context/AuthContext";
import {
  formatDateForLocale,
  formatNumberForLocale,
  useI18n,
} from "@/lib/context/I18nContext";
import { logActivity } from "@/lib/activity";
import { carLocationLabel, movementCategoryLabel } from "@/lib/i18n/enumLabels";
import { attachDealCoreMetrics } from "@/lib/finance/attachDealCoreMetrics";
import { dealListSaleDzd } from "@/app/deals/dealFinanceHelpers";
import { PageContainer } from "@/components/ui/page-container";
import { CAR_LOCATION } from "@/lib/cars/carLocations";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
type ListingRateKey = "listing_usd_dzd" | "listing_eur_dzd";

type RateInfo = {
  value: number;
  updatedAt: string | null;
};

function StaffBlurGate({
  children,
  show,
}: {
  children: React.ReactNode;
  show: boolean;
}) {
  const { t } = useI18n();
  if (!show) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-[6px]">{children}</div>
      <div
        className="absolute inset-0 flex items-center justify-center rounded-lg"
        style={{ background: "rgba(255,255,255,0.95)" }}
      >
        <span
          className="text-sm font-medium"
          style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}
        >
          {t("dashboard.managersOnly")}
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { role, permissions, profile, user } = useAuth();
  const { t, locale } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const formatNumber = (value: number) =>
    formatNumberForLocale(locale, value, { maximumFractionDigits: 0 });

  const formatCurrency = (value: number, currency: string) =>
    `${formatNumber(value)} ${currency}`;

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "-";
    const fd = formatDateForLocale(locale, value, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return fd || "-";
  };

  const timeAgo = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const now = new Date();
    const sec = Math.round((now.getTime() - d.getTime()) / 1000);
    const loc = locale === "ar" ? "ar" : locale === "fr" ? "fr" : "en";
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: "auto" });
    if (sec < 45) return rtf.format(-sec, "second");
    const min = Math.round(sec / 60);
    if (min < 60) return rtf.format(-min, "minute");
    const hr = Math.round(min / 60);
    if (hr < 24) return rtf.format(-hr, "hour");
    const day = Math.round(hr / 24);
    if (day < 7) return rtf.format(-day, "day");
    const week = Math.round(day / 7);
    if (week < 5) return rtf.format(-week, "week");
    const month = Math.round(day / 30);
    if (month < 12) return rtf.format(-month, "month");
    const year = Math.round(day / 365);
    return rtf.format(-year, "year");
  };

  const isStaff = role === "staff";
  const isOwner = role === "owner";
  const activityLogHref = permissions.audit_log ? "/audit" : "/activity";

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

  const [listingRates, setListingRates] = useState<Record<ListingRateKey, RateInfo>>({
    listing_usd_dzd: { value: 0, updatedAt: null },
    listing_eur_dzd: { value: 0, updatedAt: null },
  });
  const [editingListingRateKey, setEditingListingRateKey] = useState<ListingRateKey | null>(null);
  const [editingListingRateValue, setEditingListingRateValue] = useState<string>("");
  const [lastSavedListingRateKey, setLastSavedListingRateKey] = useState<ListingRateKey | null>(null);

  const [editingPocketId, setEditingPocketId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState<string>("");
  const [updatingPocketId, setUpdatingPocketId] = useState<string | null>(null);
  const [showCompanySettingsBanner, setShowCompanySettingsBanner] = useState(false);

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
          .in("key", ["rate_DZD", "rate_EUR", "rate_USD", "rate_GBP", "listing_usd_dzd", "listing_eur_dzd"]),
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
        setError(tRef.current("dashboard.loadFailed"));
      }

      setCashPositions(cashPositionsData ?? []);
      const rawDeals = (dealsData as Deal[]) ?? [];
      const enrichedDeals = await attachDealCoreMetrics(supabase, rawDeals);
      setDeals(enrichedDeals);
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
        const nextListing: Record<ListingRateKey, RateInfo> = {
          listing_usd_dzd: { value: 0, updatedAt: null },
          listing_eur_dzd: { value: 0, updatedAt: null },
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
          if (row.key === "listing_usd_dzd" || row.key === "listing_eur_dzd") {
            const num = Number(row.value ?? "0");
            nextListing[row.key] = {
              value: Number.isFinite(num) ? num : 0,
              updatedAt: row.updated_at,
            };
          }
        }
        setRates(next);
        setListingRates(nextListing);
      }

      setIsLoading(false);
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    const checkCompanySettings = async () => {
      try {
        const response = await fetch("/api/settings/company", { cache: "no-store" });
        const json = (await response.json().catch(() => ({}))) as {
          is_complete?: boolean;
        };
        setShowCompanySettingsBanner(!json?.is_complete);
      } catch {
        setShowCompanySettingsBanner(false);
      }
    };
    void checkCompanySettings();
  }, [isOwner]);

  const totalAed = cashPositions
    .filter((p) => p.currency === "AED")
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const totalDzd = cashPositions
    .filter((p) => p.currency === "DZD")
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const realisedProfitAed = deals
    .filter((d) => d.status === "closed")
    .reduce((sum, d) => sum + (d.profit_aed ?? 0), 0);

  const pendingRevenueDzd = deals.reduce(
    (sum, d) => sum + (d.pending_dzd || 0),
    0
  );

  const carsInDubai = cars.filter(
    (c) => c.location === CAR_LOCATION.dubaiShowroom && c.status === "available"
  ).length;

  const carsInAlgeria = cars.filter(
    (c) => c.location === CAR_LOCATION.axiraDzShowroom && c.status === "available"
  ).length;

  const carsInTransit = cars.filter((c) => c.location === CAR_LOCATION.inTransit).length;

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
            description: r.description || t("dashboard.rentDescriptionFallback"),
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
            description: r.description || t("dashboard.rentDescriptionFallback"),
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

  const monthlyProfitData = useMemo(() => {
    const now = new Date();
    const loc = locale === "ar" ? "ar" : locale === "fr" ? "fr-FR" : "en-US";
    const monthKeys = Array.from({ length: 6 }, (_, idx) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        label: date.toLocaleDateString(loc, { month: "short" }),
      };
    });
    const base = monthKeys.map((m) => ({ month: m.label, revenue: 0, profit: 0 }));

    for (const deal of deals) {
      if (!deal.date) continue;
      const d = new Date(deal.date);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const idx = monthKeys.findIndex((m) => m.key === key);
      if (idx === -1) continue;
      base[idx].revenue += dealListSaleDzd(deal) || deal.sale_amount || 0;
      base[idx].profit += deal.profit_aed || 0;
    }
    return base;
  }, [deals, locale]);

  const cashByCurrencyData = useMemo(() => {
    const grouped = cashPositions.reduce<Record<string, number>>((acc, pocket) => {
      const currency = (pocket.currency || "").toUpperCase() || "OTHER";
      acc[currency] = (acc[currency] || 0) + (pocket.amount || 0);
      return acc;
    }, {});

    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [cashPositions]);

  const inventoryLocationData = useMemo(
    () => [
      { name: carLocationLabel(t, CAR_LOCATION.dubaiShowroom), value: carsInDubai },
      { name: carLocationLabel(t, CAR_LOCATION.axiraDzShowroom), value: carsInAlgeria },
      { name: carLocationLabel(t, CAR_LOCATION.inTransit), value: carsInTransit },
    ],
    [carsInDubai, carsInAlgeria, carsInTransit, t]
  );

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
      setError(t("dashboard.rateNonNegative"));
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
      setError(t("dashboard.rateSaveFailed"));
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

  const handleSaveListingRate = async () => {
    if (!editingListingRateKey) return;
    const value = Number(editingListingRateValue);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t("dashboard.ratePositive"));
      return;
    }
    const { data, error: saveError } = await supabase
      .from("app_settings")
      .upsert({ key: editingListingRateKey, value: String(value), updated_at: new Date().toISOString() }, { onConflict: "key" })
      .select("key, value, updated_at")
      .single();
    if (saveError) { setError(t("dashboard.listingRateSaveFailed")); return; }
    const row2 = data as { key: ListingRateKey; value: string | null; updated_at: string | null };
    const num2 = Number(row2.value ?? "0");
    setListingRates((prev) => ({ ...prev, [row2.key]: { value: Number.isFinite(num2) ? num2 : 0, updatedAt: row2.updated_at } }));
    setLastSavedListingRateKey(row2.key);
    setEditingListingRateKey(null);
    setEditingListingRateValue("");
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

    const pocketRow = cashPositions.find((p) => p.id === editingPocketId);
    if (!pocketRow) {
      setError(t("dashboard.cashPositionUpdateFailed"));
      return;
    }

    const pocketName =
      pocketRow.pocket ||
      pocketRow.name ||
      pocketRow.pocket_name ||
      pocketRow.label ||
      "";
    const currency = (pocketRow.currency || "").trim();
    if (!pocketName || !currency) {
      setError(t("dashboard.cashPositionUpdateFailed"));
      return;
    }

    const oldAmount = pocketRow.amount ?? 0;
    const delta = value - oldAmount;

    if (delta === 0) {
      setEditingPocketId(null);
      setEditingAmount("");
      return;
    }

    setUpdatingPocketId(editingPocketId);
    setError(null);

    const actorLabel =
      profile?.name?.trim() || user?.email?.trim() || t("dashboard.pocketFallback");
    const calibrationDescription = `Manual pocket adjustment by ${actorLabel}`;
    const today = new Date().toISOString().slice(0, 10);
    const calibRef = `CALIBRATION-${Date.now()}`;
    const absDelta = Math.abs(delta);
    const movementType = delta > 0 ? "In" : "Out";

    const rate =
      currency === "AED" || currency === "USD" || currency === "EUR" ? 1 : null;
    const aedEquivalent =
      currency === "AED" || currency === "USD" || currency === "EUR" ? absDelta : null;

    const { data: insertedMovement, error: movementError } = await supabase
      .from("movements")
      .insert({
        date: today,
        type: movementType,
        category: "Calibration",
        description: calibrationDescription,
        amount: absDelta,
        currency,
        rate,
        aed_equivalent: aedEquivalent,
        pocket: pocketName,
        deal_id: null,
        payment_id: null,
        reference: calibRef,
      })
      .select("id")
      .single();

    if (movementError || !insertedMovement?.id) {
      setError(
        [t("dashboard.cashPositionCalibrationFailed"), movementError?.message]
          .filter(Boolean)
          .join(" ")
      );
      setUpdatingPocketId(null);
      return;
    }

    const movementId = insertedMovement.id as string;

    const auditLog = await logActivity({
      action: "calibrated",
      entity: "cash_position",
      entity_id: editingPocketId,
      description: calibrationDescription,
      amount: delta,
      currency,
      actorName: actorLabel,
    });
    if (!auditLog.ok) {
      await supabase.from("movements").delete().eq("id", movementId);
      setError(
        [t("dashboard.cashPositionCalibrationFailed"), auditLog.error]
          .filter(Boolean)
          .join(" ")
      );
      setUpdatingPocketId(null);
      return;
    }

    const { error: updateError } = await supabase
      .from("cash_positions")
      .update({ amount: value })
      .eq("id", editingPocketId);

    if (updateError) {
      await supabase.from("movements").delete().eq("id", movementId);
      setError(
        [t("dashboard.cashPositionUpdateFailed"), updateError.message]
          .filter(Boolean)
          .join(" ")
      );
      setUpdatingPocketId(null);
      return;
    }

    setCashPositions((prev) =>
      prev.map((p) => (p.id === editingPocketId ? { ...p, amount: value } : p))
    );

    setUpdatingPocketId(null);
    setEditingPocketId(null);
    setEditingAmount("");
  };

  return (
    <div
      className="min-h-full w-full text-[var(--color-text)]"
      style={{ background: "var(--color-bg)" }}
    >
      <PageContainer size="xl" className="gap-8">
        {/* Currency Rates */}
        <StaffBlurGate show={isStaff}>
          <section className="space-y-3">
            <h2
              className="text-sm font-semibold uppercase tracking-wide"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
            >
              {t("dashboard.currencyRates")}
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
                  className="rounded-lg border p-4 text-sm card"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="text-xs font-medium uppercase tracking-wide"
                      style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}
                    >
                      {label}
                    </div>
                    {justSaved && (
                      <div className="text-[11px] font-medium" style={{ color: "var(--color-accent)" }}>
                        {t("dashboard.saved")}
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
                        className="input mr-2 w-full px-2 py-1 text-sm"
                      />
                    ) : (
                      <span
                        className="text-xl font-semibold"
                        style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}
                      >
                        {info.value > 0 ? info.value : "—"}
                      </span>
                    )}
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="primary" onPress={handleSaveRate}>
                          {t("common.save")}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onPress={handleCancelEditRate}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onPress={() => handleStartEditRate(key)}
                      >
                        {t("common.edit")}
                      </Button>
                    )}
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {`${t("dashboard.lastUpdated")}: `}
                    {info.updatedAt ? formatDate(info.updatedAt) : "—"}
                  </div>
                </div>
              );
            })}
            </div>
          </section>
        </StaffBlurGate>

        {/* Listing Rates for Public Site */}
        <StaffBlurGate show={isStaff}>
          <section className="space-y-3">
            <h2
              className="text-sm font-semibold uppercase tracking-wide"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
            >
              {t("dashboard.listingRatesTitle")}
            </h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("dashboard.listingRatesBlurb")}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { labelKey: "listingUsdLabel" as const, key: "listing_usd_dzd" as ListingRateKey, hintKey: "listingHintUsd" as const },
              { labelKey: "listingEurLabel" as const, key: "listing_eur_dzd" as ListingRateKey, hintKey: "listingHintEur" as const },
            ].map(({ labelKey, key, hintKey }) => {
              const label = t(`dashboard.${labelKey}`);
              const hint = t(`dashboard.${hintKey}`);
              const info = listingRates[key];
              const isEditing = editingListingRateKey === key;
              const justSaved = lastSavedListingRateKey === key;
              return (
                <div
                  key={key}
                  className="rounded-lg border p-4 text-sm card"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="text-xs font-medium uppercase tracking-wide"
                      style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}
                    >
                      {label}
                    </div>
                    {justSaved && (
                      <div className="text-[11px] font-medium" style={{ color: "var(--color-accent)" }}>
                        {t("dashboard.saved")}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {isEditing ? (
                      <input
                        type="number"
                        min="1"
                        step="any"
                        autoFocus
                        placeholder={hint}
                        value={editingListingRateValue}
                        onChange={(e) => setEditingListingRateValue(e.target.value)}
                        className="input mr-2 w-full px-2 py-1 text-sm"
                      />
                    ) : (
                      <span
                        className="text-xl font-semibold"
                        style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}
                      >
                        {info.value > 0 ? t("dashboard.listingRateDzd", { value: formatNumber(info.value) }) : "—"}
                      </span>
                    )}
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="primary" onPress={handleSaveListingRate}>{t("common.save")}</Button>
                        <Button type="button" size="sm" variant="secondary" onPress={() => { setEditingListingRateKey(null); setEditingListingRateValue(""); }}>{t("common.cancel")}</Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingListingRateKey(key); setEditingListingRateValue(info.value > 0 ? String(info.value) : ""); }}
                        className="rounded-md border px-2 py-1 text-xs font-medium transition hover:opacity-90"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                      >
                        {t("common.edit")}
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {`${t("dashboard.lastUpdated")}: `}{info.updatedAt ? formatDate(info.updatedAt) : "—"}
                  </div>
                </div>
              );
            })}
            </div>
          </section>
        </StaffBlurGate>

        <header className="space-y-1">
          <h1
            className="text-2xl font-semibold tracking-tight md:text-3xl"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}
          >
            {t("dashboard.brandTitle")}
          </h1>
          <p className="text-sm font-medium" style={{ color: "var(--color-accent)" }}>{t("dashboard.title")}</p>
        </header>

        {error ? (
          <Alert.Root status="danger">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}
        {isOwner && showCompanySettingsBanner ? (
          <Alert.Root status="warning">
            <Alert.Content>
              <Alert.Description>
                {t("dashboard.companySettingsBanner")}{" "}
                <Link href="/settings/company" className="underline">
                  {t("dashboard.openSettings")}
                </Link>
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        {isLoading ? (
          <Card.Root className="border border-default-200">
            <Card.Content className="flex flex-col items-center justify-center gap-3 py-12">
              <Spinner size="lg" color="danger" />
              <span className="text-sm text-default-500">{t("dashboard.loadingData")}</span>
            </Card.Content>
          </Card.Root>
        ) : (
          <>
            {/* Section 1 - Top stats */}
            <StaffBlurGate show={isStaff}>
              <section className="space-y-3">
                <h2
                  className="text-sm font-semibold uppercase tracking-wide"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
                >
                  {t("dashboard.overview")}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {t("dashboard.totalAed")}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatCurrency(totalAed || 0, "AED")}
                  </div>
                </div>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {t("dashboard.totalDzd")}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatCurrency(totalDzd || 0, "DZD")}
                  </div>
                </div>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {t("dashboard.realisedProfit")}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatCurrency(realisedProfitAed || 0, "AED")}
                  </div>
                </div>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {t("dashboard.pendingRevenue")}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatCurrency(pendingRevenueDzd || 0, "DZD")}
                  </div>
                </div>
                </div>
              </section>
            </StaffBlurGate>

            <StaffBlurGate show={isStaff}>
              <section className="space-y-3">
                <h2
                  className="text-sm font-semibold uppercase tracking-wide"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
                >
                  {t("dashboard.trendsDistribution")}
                </h2>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <Card.Root className="border border-default-200 shadow-sm xl:col-span-2">
                    <Card.Content className="p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">{t("dashboard.revenueProfitSixMonths")}</h3>
                        <span className="text-xs text-default-500">{t("dashboard.dzdRevenueAedProfitSubtitle")}</span>
                      </div>
                      <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={monthlyProfitData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(34,34,34,0.08)" />
                            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="revenue" stroke="#c41230" strokeWidth={2.5} dot={false} name={t("dashboard.chartRevenueDzd")} />
                            <Line type="monotone" dataKey="profit" stroke="#222222" strokeWidth={2.5} dot={false} name={t("dashboard.chartProfitAed")} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </Card.Content>
                  </Card.Root>

                  <Card.Root className="border border-default-200 shadow-sm">
                    <Card.Content className="p-4">
                      <h3 className="mb-3 text-sm font-semibold">{t("dashboard.inventoryByLocation")}</h3>
                      <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={inventoryLocationData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(34,34,34,0.08)" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                              {inventoryLocationData.map((entry, idx) => (
                                <Cell key={`${entry.name}-${idx}`} fill={idx === 0 ? "#c41230" : idx === 1 ? "#222222" : "#8a8a8a"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card.Content>
                  </Card.Root>
                </div>

                <Card.Root className="border border-default-200 shadow-sm">
                  <Card.Content className="p-4">
                    <h3 className="mb-3 text-sm font-semibold">{t("dashboard.cashDistributionByCurrency")}</h3>
                    <div className="h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={cashByCurrencyData} dataKey="value" nameKey="name" innerRadius={64} outerRadius={100} paddingAngle={3}>
                            {cashByCurrencyData.map((entry, idx) => (
                              <Cell key={`${entry.name}-${idx}`} fill={idx % 2 === 0 ? "#c41230" : "#222222"} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </Card.Content>
                </Card.Root>
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
                <h2
                  className="text-sm font-semibold uppercase tracking-wide"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
                >
                  {t("dashboard.pendingItems")}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {pendingClientPaymentsCount > 0 && (
                    <Link
                      href="/deals"
                      className="rounded-lg border p-4 text-left transition hover:opacity-90"
                      style={{ borderColor: "rgba(196,18,48,0.25)", background: "rgba(196,18,48,0.05)" }}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-accent)" }}>
                        {t("dashboard.pendingClientPayments")}
                      </div>
                      <div className="mt-2 text-xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}>
                        {t("dashboard.dealsCount", { count: pendingClientPaymentsCount })}
                      </div>
                      <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {t("dashboard.amountWithTotal", { amount: formatCurrency(pendingClientPaymentsTotal, "DZD") })}
                      </div>
                    </Link>
                  )}
                  {unpaidShippingCount > 0 && (
                    <Link
                      href="/containers"
                      className="rounded-lg border p-4 text-left transition hover:opacity-90"
                      style={{ borderColor: "rgba(196,18,48,0.25)", background: "rgba(196,18,48,0.05)" }}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-accent)" }}>
                        {t("dashboard.unpaidShipping")}
                      </div>
                      <div className="mt-2 text-xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}>
                        {t("dashboard.containersCount", { count: unpaidShippingCount })}
                      </div>
                    </Link>
                  )}
                  {supplierDebtTotal > 0 && (
                    <Link
                      href="/inventory"
                      className="rounded-lg border p-4 text-left transition hover:opacity-90"
                      style={{ borderColor: "rgba(196,18,48,0.25)", background: "rgba(196,18,48,0.05)" }}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-accent)" }}>
                        {t("dashboard.supplierDebt")}
                      </div>
                      <div className="mt-2 text-xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}>
                        {formatCurrency(supplierDebtTotal, "AED")}
                      </div>
                    </Link>
                  )}
                  {pendingCommissionTotal > 0 && (
                    <Link
                      href="/employees"
                      className="rounded-lg border p-4 text-left transition hover:opacity-90"
                      style={{ borderColor: "rgba(196,18,48,0.25)", background: "rgba(196,18,48,0.05)" }}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-accent)" }}>
                        {t("dashboard.unpaidCommissions")}
                      </div>
                      <div className="mt-2 text-xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}>
                        {formatCurrency(pendingCommissionTotal, "DZD")}
                      </div>
                      <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {t("dashboard.viewEmployeesCommissions")}
                      </div>
                    </Link>
                  )}
                  {pendingConversionsCount > 0 && (
                    <Link
                      href="/transfers"
                      className="rounded-lg border p-4 text-left transition hover:opacity-90"
                      style={{ borderColor: "rgba(196,18,48,0.25)", background: "rgba(196,18,48,0.05)" }}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-accent)" }}>
                        {t("dashboard.pendingConversions")}
                      </div>
                      <div className="mt-2 text-xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}>
                        {t("dashboard.conversionsCount", { count: pendingConversionsCount })}
                      </div>
                    </Link>
                  )}
                  {nextRentDue && (
                    <Link
                      href="/movements"
                      className={
                        nextRentDue.paidThisYear
                          ? "card rounded-lg border p-4 text-left transition hover:opacity-90"
                          : "rounded-lg border p-4 text-left transition hover:opacity-90"
                      }
                      style={
                        nextRentDue.paidThisYear
                          ? { borderColor: "var(--color-border)" }
                          : { borderColor: "rgba(196,18,48,0.25)", background: "rgba(196,18,48,0.05)" }
                      }
                    >
                      <div
                        className="text-xs font-medium uppercase tracking-wide"
                        style={{ color: nextRentDue.paidThisYear ? "var(--color-text-muted)" : "var(--color-accent)" }}
                      >
                        {nextRentDue.paidThisYear
                          ? t("dashboard.rentPaid")
                          : t("dashboard.nextRentDue")}
                      </div>
                      <div
                        className="mt-2 text-xl font-semibold"
                        style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}
                      >
                        {nextRentDue.paidThisYear
                          ? t("dashboard.nextDueOn", { date: formatDate(nextRentDue.date.toISOString()) })
                          : formatCurrency(nextRentDue.amount, nextRentDue.currency)}
                      </div>
                      <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {nextRentDue.paidThisYear
                          ? t("dashboard.rentYearDetail", {
                              description: nextRentDue.description,
                              amount: formatCurrency(nextRentDue.amount, nextRentDue.currency),
                            })
                          : t("dashboard.rentDueDetail", {
                              description: nextRentDue.description,
                              date: formatDate(nextRentDue.date.toISOString()),
                            })}
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
                  <h2
                    className="text-sm font-semibold uppercase tracking-wide"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
                  >
                    {t("dashboard.activity")}
                  </h2>
                  <Link
                    href={activityLogHref}
                    className="text-xs font-medium hover:underline"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {t("common.viewAll")}
                  </Link>
                </div>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  {recentActivity.length === 0 ? (
                    <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>{t("dashboard.noActivity")}</div>
                  ) : (
                    <ul className="space-y-3 text-xs">
                      {recentActivity.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <span
                            className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)" }}
                          >
                            {a.entity}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="font-medium" style={{ color: "var(--color-text)" }}>{a.description}</span>
                            {a.amount != null && a.currency && (
                              <span className="ml-2" style={{ color: "var(--color-text-muted)" }}>
                                {formatCurrency(a.amount, a.currency)}
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
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
                  <h2
                    className="text-sm font-semibold uppercase tracking-wide"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
                  >
                    {t("dashboard.cashPositions")}
                  </h2>
                </div>

                {cashPositions.length === 0 ? (
                  <div className="card rounded-lg border p-4 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                    {t("dashboard.noCashPositions")}
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
                          t("dashboard.pocketFallback");

                        return (
                          <div
                            key={pocket.id}
                            className="card rounded-lg border p-4 text-sm transition hover:opacity-90"
                            style={{ borderColor: "var(--color-border)" }}
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
                            <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                              {pocketName}
                            </div>

                            {editingPocketId === pocket.id ? (
                              <div className="mt-3 space-y-2">
                                <input
                                  type="number"
                                  value={editingAmount}
                                  onChange={(e) => setEditingAmount(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="input w-full px-2 py-1 text-xs"
                                />
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="primary"
                                    className="flex-1"
                                    onPress={handleSaveEdit}
                                    isDisabled={updatingPocketId === pocket.id}
                                  >
                                    {updatingPocketId === pocket.id ? t("dashboard.saving") : t("common.save")}
                                  </Button>
                                  <Button type="button" size="sm" variant="secondary" className="flex-1" onPress={handleCancelEdit}>
                                    {t("common.cancel")}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 text-lg font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                                {formatNumber(pocket.amount || 0)}{" "}
                                <span className="text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
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
              <h2
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
              >
                {t("dashboard.inventory")}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {carLocationLabel(t, CAR_LOCATION.dubaiShowroom)}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatNumber(carsInDubai || 0)}
                  </div>
                </div>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {carLocationLabel(t, CAR_LOCATION.axiraDzShowroom)}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatNumber(carsInAlgeria || 0)}
                  </div>
                </div>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {carLocationLabel(t, CAR_LOCATION.inTransit)}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatNumber(carsInTransit || 0)}
                  </div>
                </div>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}>
                    {t("dashboard.totalCarsShort")}
                  </div>
                  <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}>
                    {formatNumber(totalAvailableCars || 0)}
                  </div>
                </div>
              </div>
            </section>

            {/* Section 4 - Recent Deals & Movements */}
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <h2
                  className="text-sm font-semibold uppercase tracking-wide"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
                >
                  {t("dashboard.recentDeals")}
                </h2>
                <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                  {recentDeals.length === 0 ? (
                    <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>{t("dashboard.noDeals")}</div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      {recentDeals.map((deal) => (
                        <div
                          key={deal.id}
                          className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium" style={{ fontFamily: "var(--font-body)", color: "var(--color-text)" }}>
                              {deal.client_name ?? t("dashboard.unknownClient")}
                            </span>
                            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                              {formatDate(deal.date ?? deal.created_at)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                            <span>{deal.car_label ?? t("dashboard.car")}</span>
                            <span>
                              {t("dashboard.saleLabel")}{" "}
                              <span className="font-semibold" style={{ color: "var(--color-text)" }}>
                                {(() => {
                                  const dzd = dealListSaleDzd(deal);
                                  if (dzd > 0) return formatCurrency(dzd, "DZD");
                                  return formatCurrency(deal.sale_amount || 0, deal.sale_currency || "DZD");
                                })()}
                              </span>
                            </span>
                            <span>
                              {t("dashboard.profitLabel")}{" "}
                              <span className="font-semibold" style={{ color: "var(--color-accent)" }}>
                                {formatCurrency(deal.profit_aed ?? 0, "AED")}
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
                  <h2
                    className="text-sm font-semibold uppercase tracking-wide"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-muted)" }}
                  >
                    {t("dashboard.recentMovements")}
                  </h2>
                  <div className="card rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
                    {movements.length === 0 ? (
                      <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>{t("dashboard.noMovements")}</div>
                    ) : (
                      <div className="space-y-3 text-xs">
                        {movements.map((movement) => (
                          <div
                            key={movement.id}
                            className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0"
                            style={{ borderColor: "var(--color-border)" }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium" style={{ color: "var(--color-text)" }}>{movementCategoryLabel(t, movement.category)}</span>
                              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                {formatDate(movement.date ?? movement.created_at)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                              <span>{formatCurrency(movement.amount || 0, movement.currency ?? "AED")}</span>
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
      </PageContainer>
    </div>
  );
}

