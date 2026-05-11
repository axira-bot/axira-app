"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "@heroui/react";
import type { Car, Deal, Movement, Rent } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx-js-style";
import { getRates, type AppRates } from "@/lib/rates";
import { attachDealCoreMetrics } from "@/lib/finance/attachDealCoreMetrics";
import { dealListSaleDzd } from "@/app/deals/dealFinanceHelpers";
import { toAed, usdPerAedFromAppUsdSetting } from "@/lib/finance/dealMoney";
import { PageContainer } from "@/components/ui/page-container";
import { CAR_LOCATIONS } from "@/lib/cars/carLocations";
import {
  formatDateForLocale,
  formatNumberForLocale,
  useI18n,
  type Locale,
  type TranslateFn,
} from "@/lib/context/I18nContext";
import {
  carLocationLabel,
  dealLifecycleLabel,
  dealStatusLabel,
  inventoryLifecycleLabel,
  movementCategoryLabel,
  movementTypeLabel,
  pocketDetailLabel,
} from "@/lib/i18n/enumLabels";

const ACCENT_RED = "C0392B";
const WHITE = "FFFFFF";
const LIGHT_GRAY = "E8E8E8";
const DARK_GRAY = "404040";
const GREEN = "2E7D32";
const RED = "C62828";
const BLUE = "1565C0";

type CellStyle = {
  font?: { bold?: boolean; color?: { rgb: string }; sz?: number; name?: string };
  fill?: { fgColor?: { rgb: string }; patternType?: string };
  alignment?: { horizontal?: string };
  numFmt?: string;
};

function setCellStyle(ws: XLSX.WorkSheet, r: number, c: number, style: CellStyle) {
  const ref = XLSX.utils.encode_cell({ r, c });
  if (!ws[ref]) ws[ref] = { t: "s", v: "" };
  (ws[ref] as { s?: CellStyle }).s = style;
}

function setCellValueAndStyle(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  value: string | number,
  style?: CellStyle
) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell: { t: string; v: string | number; s?: CellStyle } = {
    t: typeof value === "number" ? "n" : "s",
    v: value,
  };
  if (style) cell.s = style;
  ws[ref] = cell;
}

type CashPosition = {
  id: string;
  pocket: string | null;
  amount: number | null;
  currency: string | null;
};

/** Pocket names stored in DB / cash_positions; display via pocketDetailLabel */
const POCKETS = ["Dubai Cash", "Dubai Bank", "Algeria Cash", "Algeria Bank", "Qatar"] as const;

const FILTER_ALL = "__ALL__" as const;

const CAR_COST_KEY = "car_cost_aed";

const PL_EXPENSE_TYPE_ORDER = [
  "purchase_advance",
  "shipping",
  "customs",
  "inspection",
  "recovery",
  "maintenance",
  "other",
] as const;

type DealExpenseDbRow = {
  deal_id: string;
  expense_type: string;
  amount: number;
  currency: string;
  rate_to_aed: number;
};

function orderedPlExpenseCategoryKeys(map: Record<string, number>): string[] {
  const keys = Object.keys(map);
  const head = [CAR_COST_KEY, ...PL_EXPENSE_TYPE_ORDER].filter((k) => keys.includes(k));
  const tail = keys.filter((k) => !head.includes(k)).sort();
  return [...head, ...tail];
}

function plCategoryLabel(
  key: string,
  t: (k: string) => string
): string {
  if (key === CAR_COST_KEY) return t("reports.plExpense.carCostAed");
  const expenseKey = `reports.expenseType.${key}`;
  const tr = t(expenseKey);
  if (tr !== expenseKey) return tr;
  return key;
}

function dealSourceReportLabel(t: TranslateFn, src: string | null | undefined): string {
  const s = src ?? "STOCK";
  if (s === "STOCK") return t("reports.dealSourceStock");
  if (s === "PRE_ORDER_CATALOG") return t("reports.dealSourcePreOrderCatalog");
  if (s === "PRE_ORDER_CUSTOM") return t("reports.dealSourcePreOrderCustom");
  return s;
}

function inventoryExportStatus(t: TranslateFn, c: Car): string {
  return (
    inventoryLifecycleLabel(t, c.inventory_lifecycle_status) ||
    dealStatusLabel(t, c.status) ||
    (c.status ?? "").trim() ||
    ""
  );
}

function formatReportExportDate(locale: Locale, value: string | null | undefined): string {
  if (!value) return "";
  return (
    formatDateForLocale(locale, value, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) || ""
  );
}

function dealRateDzdPerAedForReport(d: Deal, usdPerAed: number): number {
  const sr = d.sale_rate_to_aed;
  if (sr == null || !(sr > 0) || !(usdPerAed > 0)) return 0;
  return 1 / (sr * usdPerAed);
}

function dealTotalExpensesAed(d: Deal): number {
  return (d.cost_aed ?? 0) + (d.expenses_aed_total ?? 0);
}

function countOverlappingMonths(
  periodFrom: string,
  periodTo: string,
  rangeStart: string | null | undefined,
  rangeEnd: string | null | undefined
): number {
  if (!rangeStart) return 0;
  const pStart = new Date(periodFrom);
  const pEnd = new Date(periodTo);
  const rStart = new Date(rangeStart);
  const rEnd = rangeEnd ? new Date(rangeEnd) : new Date(periodTo);
  if ([pStart, pEnd, rStart, rEnd].some((d) => Number.isNaN(d.getTime()))) return 0;

  const start = new Date(Math.max(pStart.getTime(), rStart.getTime()));
  const end = new Date(Math.min(pEnd.getTime(), rEnd.getTime()));
  if (end < start) return 0;

  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    1
  );
}

function getAedAmount(m: Movement): number {
  if (m.currency === "AED" || !m.currency) return m.amount || 0;
  if (m.aed_equivalent != null) return m.aed_equivalent;
  const rate = m.rate || 0;
  return (m.amount || 0) * rate;
}

function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(workbook, filename);
}

type ReportTab = "pl" | "inventory" | "deals" | "cashflow";

export default function ReportsPage() {
  const { locale, t } = useI18n();
  const fmtNum = (n: number) =>
    formatNumberForLocale(locale, n, { maximumFractionDigits: 0 });
  const fmtMoney = (
    value: number | null | undefined,
    currency: string | null | undefined
  ) => {
    const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
    const c = currency || "AED";
    return `${fmtNum(v)}${c ? ` ${c}` : ""}`;
  };
  const cellEmpty = t("reports.cellEmpty");
  const fmtDateCell = (value: string | null | undefined) => {
    if (!value) return cellEmpty;
    const s = formatDateForLocale(locale, value, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return s || cellEmpty;
  };
  const [activeTab, setActiveTab] = useState<ReportTab>("pl");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealExpenseRows, setDealExpenseRows] = useState<DealExpenseDbRow[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [cashPositions, setCashPositions] = useState<CashPosition[]>([]);
  const [rents, setRents] = useState<Rent[]>([]);
  const [rates, setRates] = useState<AppRates | null>(null);

  const [plFrom, setPlFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [plTo, setPlTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [invLocation, setInvLocation] = useState<string>(FILTER_ALL);
  const [invStatus, setInvStatus] = useState<string>(FILTER_ALL);

  const [dealsStatus, setDealsStatus] = useState<string>(FILTER_ALL);
  const [dealsSource, setDealsSource] = useState<string>(FILTER_ALL);
  const [dealsFrom, setDealsFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dealsTo, setDealsTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [cfFrom, setCfFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [cfTo, setCfTo] = useState(() => new Date().toISOString().slice(0, 10));

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const [
      { data: dealsData, error: dealsErr },
      { data: carsData, error: carsErr },
      { data: movesData, error: movesErr },
      { data: cashData, error: cashErr },
      { data: rentsData, error: rentsErr },
    ] = await Promise.all([
      supabase.from("deals").select("*").order("date", { ascending: false }),
      supabase.from("cars").select("*").order("created_at", { ascending: false }),
      supabase.from("movements").select("*").order("date", { ascending: false }),
      supabase.from("cash_positions").select("id, pocket, amount, currency"),
      supabase.from("rents").select("*"),
    ]);
    if (dealsErr || carsErr || movesErr || cashErr || rentsErr) {
      setError(
        [
          dealsErr?.message,
          carsErr?.message,
          movesErr?.message,
          cashErr?.message,
          rentsErr?.message,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
    const rawDeals = (dealsData as Deal[]) ?? [];
    const enrichedDeals = await attachDealCoreMetrics(supabase, rawDeals);
    setDeals(enrichedDeals);
    const dealIds = rawDeals.map((d) => d.id).filter(Boolean);
    if (dealIds.length) {
      const { data: exData } = await supabase
        .from("deal_expenses")
        .select("deal_id, expense_type, amount, currency, rate_to_aed")
        .in("deal_id", dealIds);
      setDealExpenseRows((exData as DealExpenseDbRow[]) ?? []);
    } else {
      setDealExpenseRows([]);
    }
    setCars((carsData as Car[]) ?? []);
    setMovements((movesData as Movement[]) ?? []);
    setCashPositions((cashData as CashPosition[]) ?? []);
    setRents((rentsData as Rent[]) ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    (async () => {
      const r = await getRates();
      setRates(r);
    })();
  }, []);

  const plFilteredDeals = useMemo(() => {
    return deals.filter((d) => {
      const date = d.date || "";
      return date >= plFrom && date <= plTo;
    });
  }, [deals, plFrom, plTo]);

  const plExpensesByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    plFilteredDeals.forEach((d) => {
      map[CAR_COST_KEY] = (map[CAR_COST_KEY] ?? 0) + (d.cost_aed ?? 0);
    });
    const ids = new Set(plFilteredDeals.map((d) => d.id));
    dealExpenseRows.forEach((row) => {
      if (!ids.has(row.deal_id)) return;
      const key = row.expense_type || "other";
      map[key] = (map[key] ?? 0) + toAed(row.amount, row.currency, row.rate_to_aed);
    });
    return map;
  }, [plFilteredDeals, dealExpenseRows]);

  const plExpenseRowKeys = useMemo(
    () => orderedPlExpenseCategoryKeys(plExpensesByCategory),
    [plExpensesByCategory]
  );

  const plRevenue = useMemo(
    () => plFilteredDeals.reduce((s, d) => s + (d.sale_aed_derived ?? 0), 0),
    [plFilteredDeals]
  );

  const plTotalExpenses = useMemo(
    () => Object.values(plExpensesByCategory).reduce((s, v) => s + v, 0),
    [plExpensesByCategory]
  );

  const plGrossProfit = useMemo(
    () => plFilteredDeals.reduce((s, d) => s + (d.profit_aed ?? 0), 0),
    [plFilteredDeals]
  );

  const plActiveRentsInPeriod = useMemo(() => {
    return rents.filter((r) => {
      if ((r.status || "").toLowerCase() !== "active") return false;
      const start = r.start_date || "";
      const end = r.end_date || "";
      if (start > plTo) return false;
      if (end && end < plFrom) return false;
      return true;
    });
  }, [rents, plFrom, plTo]);

  const plRentExpense = useMemo(() => {
    if (!rates) return 0;
    return plActiveRentsInPeriod.reduce((sum, r) => {
      const overlapMonths = countOverlappingMonths(plFrom, plTo, r.start_date, r.end_date);
      if (overlapMonths <= 0) return sum;
      const monthlyBase = (r.annual_amount || 0) / 12;
      const currency = (r.currency || "AED").toUpperCase();
      let monthlyAed = 0;
      if (currency === "AED") {
        monthlyAed = monthlyBase;
      } else if (currency === "DZD" && rates.DZD > 0) {
        // rate_DZD is DZD per 1 AED, so convert DZD → AED by dividing
        monthlyAed = monthlyBase / rates.DZD;
      }
      return sum + monthlyAed * overlapMonths;
    }, 0);
  }, [plActiveRentsInPeriod, plFrom, plTo, rates]);
  const plTotalExpensesWithRent = plTotalExpenses + plRentExpense;
  const plGrossProfitWithRent = plRevenue - plTotalExpensesWithRent;
  const plMargin =
    plRevenue > 0 ? (plGrossProfitWithRent / plRevenue) * 100 : 0;

  const invFilteredCars = useMemo(() => {
    return cars.filter((c) => {
      if (invLocation !== FILTER_ALL && (c.location || "") !== invLocation)
        return false;
      const lifecycle = (c.inventory_lifecycle_status || "").toLowerCase();
      const legacy = (c.status || "").toLowerCase();
      if (
        invStatus !== FILTER_ALL &&
        lifecycle !== invStatus.toLowerCase() &&
        legacy !== invStatus.toLowerCase()
      )
        return false;
      return true;
    });
  }, [cars, invLocation, invStatus]);

  const invSummary = useMemo(() => {
    const total = cars.length;
    const available = cars.filter((c) => {
      const s = (c.status || "").toLowerCase();
      const l = (c.inventory_lifecycle_status || "").toLowerCase();
      return s === "available" || l === "in_stock" || l === "arrived" || l === "ready_to_ship";
    }).length;
    const sold = cars.filter((c) => {
      const s = (c.status || "").toLowerCase();
      const l = (c.inventory_lifecycle_status || "").toLowerCase();
      return s === "sold" || l === "delivered";
    }).length;
    const inTransit = cars.filter((c) => {
      const l = (c.inventory_lifecycle_status || "").toLowerCase();
      return l === "in_transit" || (c.location || "").toLowerCase().includes("transit");
    }).length;
    let totalValue = 0;
    cars
      .filter((c) => {
        const s = (c.status || "").toLowerCase();
        const l = (c.inventory_lifecycle_status || "").toLowerCase();
        return s === "available" || l === "in_stock" || l === "arrived" || l === "ready_to_ship";
      })
      .forEach((c) => {
        const price = c.purchase_price || 0;
        const curr = (c.purchase_currency || "AED").toUpperCase();
        const rate = curr === "AED" ? 1 : (c.purchase_rate || 1);
        totalValue += price * rate;
      });
    return { total, available, sold, inTransit, totalValue };
  }, [cars]);

  const dealsFiltered = useMemo(() => {
    return deals.filter((d) => {
      const lifecycle = (d.lifecycle_status || "").toLowerCase();
      const legacy = (d.status || "").toLowerCase();
      if (
        dealsStatus !== FILTER_ALL &&
        lifecycle !== dealsStatus.toLowerCase() &&
        legacy !== dealsStatus.toLowerCase()
      )
        return false;
      if (dealsSource !== FILTER_ALL && (d.source || "STOCK") !== dealsSource) return false;
      const date = d.date || "";
      return date >= dealsFrom && date <= dealsTo;
    });
  }, [deals, dealsStatus, dealsSource, dealsFrom, dealsTo]);

  const dealsSummary = useMemo(() => {
    const total = dealsFiltered.length;
    const revenueDzd = dealsFiltered.reduce((s, d) => s + (dealListSaleDzd(d) || 0), 0);
    const revenueAed = dealsFiltered.reduce((s, d) => s + (d.sale_aed_derived ?? 0), 0);
    const totalProfit = dealsFiltered.reduce((s, d) => s + (d.profit_aed ?? 0), 0);
    const avgProfit = total > 0 ? totalProfit / total : 0;
    return { total, revenueDzd, revenueAed, totalProfit, avgProfit };
  }, [dealsFiltered]);

  const cfFilteredMovements = useMemo(() => {
    return movements.filter((m) => {
      const date = m.date || "";
      return date >= cfFrom && date <= cfTo;
    });
  }, [movements, cfFrom, cfTo]);

  const cfByCurrency = useMemo(() => {
    const aed = { income: 0, expenses: 0 };
    const dzd = { income: 0, expenses: 0 };
    cfFilteredMovements.forEach((m) => {
      if ((m.category || "").toLowerCase() === "opening balance") return;
      const typeIn = (m.type || "").toLowerCase() === "in";
      const amount = m.amount ?? 0;
      const curr = (m.currency || "AED").toUpperCase();
      if (curr === "AED") {
        if (typeIn) aed.income += amount;
        else aed.expenses += amount;
      } else if (curr === "DZD") {
        if (typeIn) dzd.income += amount;
        else dzd.expenses += amount;
      }
    });
    return { aed, dzd };
  }, [cfFilteredMovements]);

  const pocketBalances = useMemo(() => {
    const map: Record<string, { amount: number; currency: string | null }> = {};
    POCKETS.forEach((p) => (map[p] = { amount: 0, currency: null }));
    cashPositions.forEach((p) => {
      const name = p.pocket || "";
      if (name) {
        map[name] = {
          amount: p.amount || 0,
          currency: p.currency || null,
        };
      }
    });
    return map;
  }, [cashPositions]);

  const exportPl = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const maxCol = 9;
    const f0 = (n: number) =>
      formatNumberForLocale(locale, n, { maximumFractionDigits: 0 });
    const emptyCell = t("reports.cellEmpty");
    const periodLabel = t("reports.dateRange", { from: plFrom, to: plTo });
    const data: (string | number)[][] = [
      [t("reports.companyLegalName")],
      [t("reports.plReportTitle"), periodLabel],
      [],
      [t("reports.totalRevenueAed"), plRevenue],
      [t("reports.totalExpensesAed"), plTotalExpensesWithRent],
      [t("reports.grossProfitAed"), plGrossProfitWithRent],
      [t("reports.profitMarginPct"), plMargin],
      [],
      [t("reports.expensesBreakdown")],
      ...plExpenseRowKeys.map((key) => [
        plCategoryLabel(key, t),
        plExpensesByCategory[key] ?? 0,
      ]),
      ...plActiveRentsInPeriod
        .map((r) => {
          if (!rates) return null;
          const monthlyBase = (r.annual_amount || 0) / 12;
          const currency = (r.currency || "AED").toUpperCase();
          let monthlyAed = 0;
          let label = "";

          if (currency === "AED") {
            monthlyAed = monthlyBase;
            label = t("reports.rentRowAed", {
              description: r.description || emptyCell,
              monthlyAed: f0(monthlyAed),
            });
          } else if (currency === "DZD" && rates.DZD > 0) {
            monthlyAed = monthlyBase / rates.DZD;
            label = t("reports.rentRowDzd", {
              description: r.description || emptyCell,
              monthlyAed: f0(monthlyAed),
              monthlyBase: f0(monthlyBase),
            });
          } else {
            return null;
          }

          const overlapMonths = countOverlappingMonths(plFrom, plTo, r.start_date, r.end_date);
          return [label, monthlyAed * overlapMonths] as [string, number];
        })
        .filter(Boolean) as (string | number)[][],
      [],
      [t("reports.dealsSection")],
      [
        t("reports.client"),
        t("reports.car"),
        t("reports.date"),
        t("reports.saleDzd"),
        t("reports.rateCol"),
        t("reports.saleAed"),
        t("reports.expensesCol"),
        t("reports.profitCol"),
        t("reports.status"),
      ],
      ...plFilteredDeals.map((d) => {
        const usdPerAed = usdPerAedFromAppUsdSetting(rates?.USD ?? 0);
        return [
          d.client_name ?? "",
          d.car_label ?? "",
          formatReportExportDate(locale, d.date),
          dealListSaleDzd(d) || 0,
          dealRateDzdPerAedForReport(d, usdPerAed),
          d.sale_aed_derived ?? 0,
          dealTotalExpensesAed(d),
          d.profit_aed ?? 0,
          dealStatusLabel(t, d.status) || d.status || "",
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);

    const headerStyle: CellStyle = {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    };
    setCellValueAndStyle(ws, 0, 0, t("reports.companyLegalName"), headerStyle);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];

    setCellValueAndStyle(ws, 1, 0, t("reports.plReportTitle"), {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, periodLabel, {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });

    setCellValueAndStyle(ws, 3, 0, t("reports.totalRevenueAed"), { font: { bold: true } });
    setCellValueAndStyle(ws, 3, 1, plRevenue, { numFmt: "#,##0" });
    setCellValueAndStyle(ws, 4, 0, t("reports.totalExpensesAed"), { font: { bold: true } });
    setCellValueAndStyle(ws, 4, 1, plTotalExpensesWithRent, { numFmt: "#,##0" });
    setCellValueAndStyle(ws, 5, 0, t("reports.grossProfitAed"), { font: { bold: true } });
    setCellValueAndStyle(ws, 5, 1, plGrossProfitWithRent, {
      numFmt: "#,##0",
      font: { bold: true, color: { rgb: plGrossProfitWithRent >= 0 ? GREEN : RED } },
    });
    setCellValueAndStyle(ws, 6, 0, t("reports.profitMarginPct"), { font: { bold: true } });
    setCellValueAndStyle(ws, 6, 1, plMargin, { numFmt: "0.00%" });

    const expenseHeaderRow = 8;
    setCellValueAndStyle(ws, expenseHeaderRow, 0, t("reports.expensesBreakdown"), {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: expenseHeaderRow, c: 0 }, e: { r: expenseHeaderRow, c: 2 } }];
    plExpenseRowKeys.forEach((catKey, i) => {
      const r = expenseHeaderRow + 1 + i;
      const label = plCategoryLabel(catKey, t);
      setCellValueAndStyle(
        ws,
        r,
        0,
        label,
        i % 2 === 0 ? {} : { fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" } }
      );
      setCellValueAndStyle(ws, r, 1, plExpensesByCategory[catKey] ?? 0, {
        numFmt: "#,##0",
        ...(i % 2 === 0 ? {} : { fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" } }),
      });
    });
    plActiveRentsInPeriod.forEach((r, i) => {
      if (!rates) return;
      const monthlyBase = (r.annual_amount || 0) / 12;
      const currency = (r.currency || "AED").toUpperCase();
      let monthlyAed = 0;
      let label = "";

      if (currency === "AED") {
        monthlyAed = monthlyBase;
        label = t("reports.rentRowAed", {
          description: r.description || emptyCell,
          monthlyAed: f0(monthlyAed),
        });
      } else if (currency === "DZD" && rates.DZD > 0) {
        monthlyAed = monthlyBase / rates.DZD;
        label = t("reports.rentRowDzd", {
          description: r.description || emptyCell,
          monthlyAed: f0(monthlyAed),
          monthlyBase: f0(monthlyBase),
        });
      } else {
        return;
      }

      const rentRow = expenseHeaderRow + 1 + plExpenseRowKeys.length + i;
      setCellValueAndStyle(ws, rentRow, 0, label, {
        fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
      });
      const overlapMonths = countOverlappingMonths(plFrom, plTo, r.start_date, r.end_date);
      setCellValueAndStyle(ws, rentRow, 1, monthlyAed * overlapMonths, {
        numFmt: "#,##0",
        fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
      });
    });

    const dealsHeaderRow =
      expenseHeaderRow + 1 + plExpenseRowKeys.length + plActiveRentsInPeriod.length + 1;
    setCellValueAndStyle(ws, dealsHeaderRow, 0, t("reports.dealsSection"), {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: dealsHeaderRow, c: 0 }, e: { r: dealsHeaderRow, c: maxCol } }];
    const dealColHeaders = [
      t("reports.client"),
      t("reports.car"),
      t("reports.date"),
      t("reports.saleDzd"),
      t("reports.rateCol"),
      t("reports.saleAed"),
      t("reports.expensesCol"),
      t("reports.profitCol"),
      t("reports.status"),
    ];
    dealColHeaders.forEach((h, c) => setCellValueAndStyle(ws, dealsHeaderRow + 1, c, h, { font: { bold: true } }));
    plFilteredDeals.forEach((d, i) => {
      const r = dealsHeaderRow + 2 + i;
      const usdPerAed = usdPerAedFromAppUsdSetting(rates?.USD ?? 0);
      const row = [
        d.client_name ?? "",
        d.car_label ?? "",
        formatReportExportDate(locale, d.date),
        dealListSaleDzd(d) || 0,
        dealRateDzdPerAedForReport(d, usdPerAed),
        d.sale_aed_derived ?? 0,
        dealTotalExpensesAed(d),
        d.profit_aed ?? 0,
        dealStatusLabel(t, d.status) || d.status || "",
      ];
      row.forEach((val, c) => {
        const isNum = typeof val === "number";
        const profitCol = 7;
        const style: CellStyle = isNum ? { numFmt: c === 4 ? "0.00" : "#,##0" } : {};
        if (c === profitCol && typeof val === "number")
          (style as CellStyle).font = { color: { rgb: val >= 0 ? GREEN : RED } };
        setCellValueAndStyle(ws, r, c, val, Object.keys(style).length ? style : undefined);
      });
    });

    ws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, t("reports.sheetPl"));
    downloadWorkbook(wb, t("reports.exportFilePnL", { from: plFrom, to: plTo }));
  }, [
    locale,
    t,
    plFrom,
    plTo,
    plRevenue,
    plTotalExpensesWithRent,
    plGrossProfitWithRent,
    plActiveRentsInPeriod,
    plMargin,
    plExpensesByCategory,
    plFilteredDeals,
    rates,
    plExpenseRowKeys,
  ]);

  const exportInventory = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const cols = [
      t("reports.brand"),
      t("reports.model"),
      t("reports.year"),
      t("reports.color"),
      t("reports.mileageCol"),
      t("reports.location"),
      t("reports.ownerCol"),
      t("reports.purchasePriceCol"),
      t("reports.status"),
    ];
    const today = new Date().toISOString().slice(0, 10);
    const todayLabel = formatReportExportDate(locale, today);
    const data: (string | number | null)[][] = [
      [t("reports.companyLegalName")],
      [t("reports.inventoryReportTitle"), todayLabel],
      [],
      cols,
      ...invFilteredCars.map((c) => [
        c.brand ?? "",
        c.model ?? "",
        c.year ?? "",
        c.color ?? "",
        c.mileage ?? "",
        c.location ? carLocationLabel(t, c.location) : "",
        c.owner ?? "",
        c.purchase_price ?? "",
        inventoryExportStatus(t, c),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const maxCol = cols.length - 1;
    setCellValueAndStyle(ws, 0, 0, t("reports.companyLegalName"), {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];
    setCellValueAndStyle(ws, 1, 0, t("reports.inventoryReportTitle"), {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, todayLabel, {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    cols.forEach((h, c) => setCellValueAndStyle(ws, 3, c, h, { font: { bold: true } }));
    invFilteredCars.forEach((c, i) => {
      const r = 4 + i;
      const row = [
        c.brand ?? "",
        c.model ?? "",
        c.year ?? "",
        c.color ?? "",
        c.mileage ?? "",
        c.location ? carLocationLabel(t, c.location) : "",
        c.owner ?? "",
        c.purchase_price ?? "",
        inventoryExportStatus(t, c),
      ];
      const status = (c.status || "").toLowerCase();
      const statusColor =
        status === "available" ? GREEN : status === "sold" ? RED : status.includes("transit") ? BLUE : undefined;
      row.forEach((val, cIdx) => {
        const style: CellStyle = {};
        if (typeof val === "number") style.numFmt = "#,##0";
        if (cIdx === 8 && statusColor) style.font = { color: { rgb: statusColor } };
        setCellValueAndStyle(ws, r, cIdx, val, Object.keys(style).length ? style : undefined);
      });
    });
    ws["!cols"] = cols.map((_, i) => ({ wch: i === 0 ? 14 : i === 1 ? 14 : 10 }));
    XLSX.utils.book_append_sheet(wb, ws, t("reports.sheetInventory"));
    downloadWorkbook(wb, t("reports.exportFileInventory", { date: today }));
  }, [invFilteredCars, locale, t]);

  const exportDeals = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const periodLabel = t("reports.dateRange", { from: dealsFrom, to: dealsTo });
    const cols = [
      t("reports.client"),
      t("reports.car"),
      t("reports.date"),
      t("reports.saleDzd"),
      t("reports.rateCol"),
      t("reports.saleAed"),
      t("reports.expensesCol"),
      t("reports.profitCol"),
      t("reports.collectedDzdCol"),
      t("reports.pendingDzdCol"),
      t("reports.status"),
      t("reports.lifecycleCol"),
      t("reports.sourceCol"),
    ];
    const data: (string | number | null)[][] = [
      [t("reports.companyLegalName")],
      [t("reports.dealsReportTitle"), periodLabel],
      [],
      cols,
      ...dealsFiltered.map((d) => {
        const usdPerAed = usdPerAedFromAppUsdSetting(rates?.USD ?? 0);
        return [
          d.client_name ?? "",
          d.car_label ?? "",
          formatReportExportDate(locale, d.date),
          dealListSaleDzd(d) || 0,
          dealRateDzdPerAedForReport(d, usdPerAed),
          d.sale_aed_derived ?? 0,
          dealTotalExpensesAed(d),
          d.profit_aed ?? 0,
          d.collected_dzd ?? 0,
          d.pending_dzd ?? 0,
          dealStatusLabel(t, d.status) || d.status || "",
          dealLifecycleLabel(t, d.lifecycle_status) || d.lifecycle_status || "",
          dealSourceReportLabel(t, d.source),
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const maxCol = cols.length - 1;
    setCellValueAndStyle(ws, 0, 0, t("reports.companyLegalName"), {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];
    setCellValueAndStyle(ws, 1, 0, t("reports.dealsReportTitle"), {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, periodLabel, {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    cols.forEach((h, c) => setCellValueAndStyle(ws, 3, c, h, { font: { bold: true } }));
    const profitColIdx = 7;
    dealsFiltered.forEach((d, i) => {
      const r = 4 + i;
      const usdPerAed = usdPerAedFromAppUsdSetting(rates?.USD ?? 0);
      const row = [
        d.client_name ?? "",
        d.car_label ?? "",
        formatReportExportDate(locale, d.date),
        dealListSaleDzd(d) || 0,
        dealRateDzdPerAedForReport(d, usdPerAed),
        d.sale_aed_derived ?? 0,
        dealTotalExpensesAed(d),
        d.profit_aed ?? 0,
        d.collected_dzd ?? 0,
        d.pending_dzd ?? 0,
        dealStatusLabel(t, d.status) || d.status || "",
        dealLifecycleLabel(t, d.lifecycle_status) || d.lifecycle_status || "",
        dealSourceReportLabel(t, d.source),
      ];
      row.forEach((val, cIdx) => {
        const style: CellStyle = {};
        if (typeof val === "number")
          style.numFmt = cIdx === 4 ? "0.00" : "#,##0";
        if (cIdx === profitColIdx && typeof val === "number")
          style.font = { color: { rgb: val >= 0 ? GREEN : RED } };
        setCellValueAndStyle(ws, r, cIdx, val, Object.keys(style).length ? style : undefined);
      });
    });
    ws["!cols"] = cols.map((_, i) => ({ wch: i === 0 || i === 1 ? 18 : 12 }));
    XLSX.utils.book_append_sheet(wb, ws, t("reports.sheetDeals"));
    downloadWorkbook(wb, t("reports.exportFileDeals", { from: dealsFrom, to: dealsTo }));
  }, [dealsFiltered, dealsFrom, dealsTo, locale, rates, t]);

  const exportCashFlow = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const periodLabel = t("reports.dateRange", { from: cfFrom, to: cfTo });
    const data: (string | number)[][] = [
      [t("reports.companyLegalName")],
      [t("reports.cashFlowReportTitle"), periodLabel],
      [],
      [t("reports.pocketBalances")],
      [t("reports.pocketCol"), t("reports.amountCol"), t("reports.currencyCol")],
      ...POCKETS.map((p) => [
        pocketDetailLabel(t, p),
        pocketBalances[p]?.amount ?? 0,
        pocketBalances[p]?.currency ?? "",
      ]),
      [],
      [t("reports.aedCashFlow"), ""],
      [t("reports.incomeAed"), cfByCurrency.aed.income],
      [t("reports.expensesAed"), cfByCurrency.aed.expenses],
      [t("reports.netAed"), cfByCurrency.aed.income - cfByCurrency.aed.expenses],
      [],
      [t("reports.dzdCashFlow"), ""],
      [t("reports.incomeDzd"), cfByCurrency.dzd.income],
      [t("reports.expensesDzd"), cfByCurrency.dzd.expenses],
      [t("reports.netDzd"), cfByCurrency.dzd.income - cfByCurrency.dzd.expenses],
      [],
      [t("reports.movementsSection")],
      [
        t("reports.date"),
        t("reports.movementColType"),
        t("reports.movementColCategory"),
        t("reports.amountCol"),
        t("reports.currencyCol"),
        t("reports.pocketCol"),
        t("reports.movementColDescription"),
      ],
      ...cfFilteredMovements.map((m) => [
        formatReportExportDate(locale, m.date),
        movementTypeLabel(t, m.type) || m.type || "",
        movementCategoryLabel(t, m.category) || m.category || "",
        m.amount ?? 0,
        m.currency ?? "",
        m.pocket ? pocketDetailLabel(t, m.pocket) : "",
        m.description ?? "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const maxCol = 6;
    setCellValueAndStyle(ws, 0, 0, t("reports.companyLegalName"), {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];
    setCellValueAndStyle(ws, 1, 0, t("reports.cashFlowReportTitle"), {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, periodLabel, {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 3, 0, t("reports.pocketBalances"), {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }];
    setCellValueAndStyle(ws, 4, 0, t("reports.pocketCol"), { font: { bold: true } });
    setCellValueAndStyle(ws, 4, 1, t("reports.amountCol"), { font: { bold: true } });
    setCellValueAndStyle(ws, 4, 2, t("reports.currencyCol"), { font: { bold: true } });
    POCKETS.forEach((p, i) => {
      setCellValueAndStyle(ws, 5 + i, 0, pocketDetailLabel(t, p));
      setCellValueAndStyle(ws, 5 + i, 1, pocketBalances[p]?.amount ?? 0, { numFmt: "#,##0" });
      setCellValueAndStyle(ws, 5 + i, 2, pocketBalances[p]?.currency ?? "");
    });
    const summaryStart = 5 + POCKETS.length + 2;
    setCellValueAndStyle(ws, summaryStart, 0, t("reports.aedCashFlow"), { font: { bold: true } });
    setCellValueAndStyle(ws, summaryStart + 1, 0, t("reports.incomeAed"));
    setCellValueAndStyle(ws, summaryStart + 1, 1, cfByCurrency.aed.income, {
      numFmt: "#,##0",
      font: { color: { rgb: GREEN } },
    });
    setCellValueAndStyle(ws, summaryStart + 2, 0, t("reports.expensesAed"));
    setCellValueAndStyle(ws, summaryStart + 2, 1, cfByCurrency.aed.expenses, {
      numFmt: "#,##0",
      font: { color: { rgb: RED } },
    });
    setCellValueAndStyle(ws, summaryStart + 3, 0, t("reports.netAed"));
    setCellValueAndStyle(ws, summaryStart + 3, 1, cfByCurrency.aed.income - cfByCurrency.aed.expenses, {
      numFmt: "#,##0",
    });
    setCellValueAndStyle(ws, summaryStart + 5, 0, t("reports.dzdCashFlow"), { font: { bold: true } });
    setCellValueAndStyle(ws, summaryStart + 6, 0, t("reports.incomeDzd"));
    setCellValueAndStyle(ws, summaryStart + 6, 1, cfByCurrency.dzd.income, {
      numFmt: "#,##0",
      font: { color: { rgb: GREEN } },
    });
    setCellValueAndStyle(ws, summaryStart + 7, 0, t("reports.expensesDzd"));
    setCellValueAndStyle(ws, summaryStart + 7, 1, cfByCurrency.dzd.expenses, {
      numFmt: "#,##0",
      font: { color: { rgb: RED } },
    });
    setCellValueAndStyle(ws, summaryStart + 8, 0, t("reports.netDzd"));
    setCellValueAndStyle(ws, summaryStart + 8, 1, cfByCurrency.dzd.income - cfByCurrency.dzd.expenses, {
      numFmt: "#,##0",
    });
    const moveHeaderRow = summaryStart + 10;
    setCellValueAndStyle(ws, moveHeaderRow, 0, t("reports.movementsSection"), {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: moveHeaderRow, c: 0 }, e: { r: moveHeaderRow, c: maxCol } }];
    [
      t("reports.date"),
      t("reports.movementColType"),
      t("reports.movementColCategory"),
      t("reports.amountCol"),
      t("reports.currencyCol"),
      t("reports.pocketCol"),
      t("reports.movementColDescription"),
    ].forEach((h, c) => setCellValueAndStyle(ws, moveHeaderRow + 1, c, h, { font: { bold: true } }));
    cfFilteredMovements.forEach((m, i) => {
      const r = moveHeaderRow + 2 + i;
      const row = [
        formatReportExportDate(locale, m.date),
        movementTypeLabel(t, m.type) || m.type || "",
        movementCategoryLabel(t, m.category) || m.category || "",
        m.amount ?? 0,
        m.currency ?? "",
        m.pocket ? pocketDetailLabel(t, m.pocket) : "",
        m.description ?? "",
      ];
      const isIn = (m.type || "").toLowerCase() === "in";
      row.forEach((val, cIdx) => {
        const style: CellStyle = {};
        if (cIdx === 3 && typeof val === "number") style.numFmt = "#,##0";
        if (cIdx === 1) style.font = { color: { rgb: isIn ? GREEN : RED } };
        setCellValueAndStyle(ws, r, cIdx, val, Object.keys(style).length ? style : undefined);
      });
    });
    ws["!cols"] = [{ wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, t("reports.sheetCashFlow"));
    downloadWorkbook(wb, t("reports.exportFileCashFlow", { from: cfFrom, to: cfTo }));
  }, [pocketBalances, cfFilteredMovements, cfByCurrency, cfFrom, cfTo, locale, t]);

  const tabDefs: { id: ReportTab; labelKey: string }[] = [
    { id: "pl", labelKey: "reports.tabPl" },
    { id: "inventory", labelKey: "reports.tabInventory" },
    { id: "deals", labelKey: "reports.tabDeals" },
    { id: "cashflow", labelKey: "reports.tabCashFlow" },
  ];

  return (
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t("reports.title")}
          </h1>
          <p className="text-sm font-medium text-danger">
            {t("reports.tagline")}
          </p>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-default-200 pb-2">
          {tabDefs.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              size="sm"
              variant={activeTab === tab.id ? "primary" : "outline"}
              onPress={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
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

        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-default-200 bg-content1 p-12">
            <Spinner size="md" color="danger" />
            <span className="text-sm text-default-500">{t("reports.loading")}</span>
          </div>
        ) : (
          <>
            {activeTab === "pl" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t("reports.periodFrom")}
                    <input
                      type="date"
                      value={plFrom}
                      onChange={(e) => setPlFrom(e.target.value)}
                      className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t("reports.periodTo")}
                    <input
                      type="date"
                      value={plTo}
                      onChange={(e) => setPlTo(e.target.value)}
                      className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                  <Button type="button" variant="primary" size="sm" onPress={exportPl}>
                    {t("reports.exportToExcel")}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.totalRevenueAed")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">
                      {fmtNum(plRevenue)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.totalExpensesAed")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">
                      {fmtNum(plTotalExpensesWithRent)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.grossProfitAed")}</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--color-accent)]">
                      {fmtNum(plGrossProfitWithRent)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.profitMarginPct")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">
                      {t("reports.profitMarginDisplay", { value: plMargin.toFixed(1) })}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-app surface overflow-hidden">
                  <h3 className="border-b border-app px-4 py-3 text-sm font-semibold text-app">
                    {t("reports.expensesTableHeading")}
                  </h3>
                  <div className="responsive-table-wrap">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-app text-muted">
                        <tr>
                          <th className="px-4 py-3">{t("reports.category")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.amount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plExpenseRowKeys.map((catKey) => (
                          <tr key={catKey} className="border-b border-app last:border-b-0">
                            <td className="px-4 py-3 text-app">{plCategoryLabel(catKey, t)}</td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(plExpensesByCategory[catKey] ?? 0)}
                            </td>
                          </tr>
                        ))}
                        {plActiveRentsInPeriod.map((r) => {
                          if (!rates) return null;
                          const monthlyBase = (r.annual_amount || 0) / 12;
                          const currency = (r.currency || "AED").toUpperCase();
                          let monthlyAed = 0;
                          let rentLabel = "";

                          if (currency === "AED") {
                            monthlyAed = monthlyBase;
                            rentLabel = t("reports.rentRowAed", {
                              description: r.description || cellEmpty,
                              monthlyAed: fmtNum(monthlyAed),
                            });
                          } else if (currency === "DZD" && rates.DZD > 0) {
                            monthlyAed = monthlyBase / rates.DZD;
                            rentLabel = t("reports.rentRowDzd", {
                              description: r.description || cellEmpty,
                              monthlyAed: fmtNum(monthlyAed),
                              monthlyBase: fmtNum(monthlyBase),
                            });
                          } else {
                            return null;
                          }

                          const overlapMonths = countOverlappingMonths(plFrom, plTo, r.start_date, r.end_date);
                          const periodAmountAed = monthlyAed * overlapMonths;

                          return (
                            <tr key={r.id} className="border-b border-app last:border-b-0">
                              <td className="px-4 py-3 text-app">{rentLabel}</td>
                              <td className="px-4 py-3 text-right text-app">
                                {fmtNum(periodAmountAed)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-lg border border-app surface overflow-hidden">
                  <h3 className="border-b border-app px-4 py-3 text-sm font-semibold text-app">
                    {t("reports.dealsWithProfit")}
                  </h3>
                  <div className="responsive-table-wrap">
                    <table className="min-w-[620px] w-full text-left text-xs">
                      <thead className="border-b border-app text-muted">
                        <tr>
                          <th className="px-4 py-3">{t("reports.client")}</th>
                          <th className="px-4 py-3">{t("reports.car")}</th>
                          <th className="px-4 py-3">{t("reports.date")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.saleAed")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.profitAed")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plFilteredDeals.map((d) => (
                          <tr key={d.id} className="border-b border-app last:border-b-0">
                            <td className="px-4 py-3 text-app">{d.client_name ?? cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{d.car_label ?? cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{fmtDateCell(d.date)}</td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(d.sale_aed_derived ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(d.profit_aed ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "inventory" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-4">
                  <select
                    value={invLocation}
                    onChange={(e) => setInvLocation(e.target.value)}
                    className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  >
                    <option value={FILTER_ALL}>{t("reports.invAllLocations")}</option>
                    {CAR_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>
                        {carLocationLabel(t, loc)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={invStatus}
                    onChange={(e) => setInvStatus(e.target.value)}
                    className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  >
                    <option value={FILTER_ALL}>{t("reports.invAllStatuses")}</option>
                    <option value="available">{t("reports.legacyAvailable")}</option>
                    <option value="sold">{t("reports.legacySold")}</option>
                    <option value="in_stock">{inventoryLifecycleLabel(t, "IN_STOCK")}</option>
                    <option value="incoming">{inventoryLifecycleLabel(t, "INCOMING")}</option>
                    <option value="in_transit">{inventoryLifecycleLabel(t, "IN_TRANSIT")}</option>
                    <option value="arrived">{inventoryLifecycleLabel(t, "ARRIVED")}</option>
                    <option value="ready_to_ship">{inventoryLifecycleLabel(t, "READY_TO_SHIP")}</option>
                    <option value="delivered">{inventoryLifecycleLabel(t, "DELIVERED")}</option>
                  </select>
                  <Button type="button" variant="primary" size="sm" onPress={exportInventory}>
                    {t("reports.exportToExcel")}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.totalCars")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">{invSummary.total}</div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.available")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">{invSummary.available}</div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.sold")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">{invSummary.sold}</div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.inTransit")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">{invSummary.inTransit}</div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.totalInventoryValueAed")}</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--color-accent)]">
                      {fmtNum(invSummary.totalValue)}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-app surface overflow-hidden">
                  <div className="responsive-table-wrap">
                    <table className="min-w-[620px] w-full text-left text-xs">
                      <thead className="border-b border-app text-muted">
                        <tr>
                          <th className="px-4 py-3">{t("reports.brand")}</th>
                          <th className="px-4 py-3">{t("reports.model")}</th>
                          <th className="px-4 py-3">{t("reports.year")}</th>
                          <th className="px-4 py-3">{t("reports.price")}</th>
                          <th className="px-4 py-3">{t("reports.location")}</th>
                          <th className="px-4 py-3">{t("reports.status")}</th>
                          <th className="px-4 py-3">{t("reports.client")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invFilteredCars.map((c) => (
                          <tr key={c.id} className="border-b border-app last:border-b-0">
                            <td className="px-4 py-3 text-app">{c.brand ?? cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{c.model ?? cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{c.year ?? cellEmpty}</td>
                            <td className="px-4 py-3 text-app">
                              {c.purchase_price != null ? fmtNum(c.purchase_price) : cellEmpty}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {c.location ? carLocationLabel(t, c.location) : cellEmpty}
                            </td>
                            <td className="px-4 py-3 text-app">
                              {inventoryLifecycleLabel(t, c.inventory_lifecycle_status) ||
                                dealStatusLabel(t, c.status) ||
                                c.status ||
                                cellEmpty}
                            </td>
                            <td className="px-4 py-3 text-app">{c.client_name ?? cellEmpty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "deals" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-end gap-4">
                  <select
                    value={dealsStatus}
                    onChange={(e) => setDealsStatus(e.target.value)}
                    className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  >
                    <option value={FILTER_ALL}>{t("reports.dealsFilterAllStatuses")}</option>
                    <option value="pending">{dealStatusLabel(t, "pending")}</option>
                    <option value="closed">{dealStatusLabel(t, "closed")}</option>
                    <option value="pre_order">{dealLifecycleLabel(t, "PRE_ORDER")}</option>
                    <option value="ordered">{dealLifecycleLabel(t, "ORDERED")}</option>
                    <option value="shipped">{dealLifecycleLabel(t, "SHIPPED")}</option>
                    <option value="arrived">{dealLifecycleLabel(t, "ARRIVED")}</option>
                    <option value="cancelled">{dealLifecycleLabel(t, "CANCELLED")}</option>
                  </select>
                  <select
                    value={dealsSource}
                    onChange={(e) => setDealsSource(e.target.value)}
                    className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  >
                    <option value={FILTER_ALL}>{t("reports.dealsFilterAllSources")}</option>
                    <option value="STOCK">{t("reports.dealSourceStock")}</option>
                    <option value="PRE_ORDER_CATALOG">{t("reports.dealSourcePreOrderCatalog")}</option>
                    <option value="PRE_ORDER_CUSTOM">{t("reports.dealSourcePreOrderCustom")}</option>
                  </select>
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t("reports.periodFrom")}
                    <input
                      type="date"
                      value={dealsFrom}
                      onChange={(e) => setDealsFrom(e.target.value)}
                      className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t("reports.periodTo")}
                    <input
                      type="date"
                      value={dealsTo}
                      onChange={(e) => setDealsTo(e.target.value)}
                      className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                  <Button type="button" variant="primary" size="sm" onPress={exportDeals}>
                    {t("reports.exportToExcel")}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.summaryTotalDeals")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">{dealsSummary.total}</div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.summaryTotalRevenueDzd")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">
                      {fmtNum(dealsSummary.revenueDzd)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.summaryTotalRevenueAed")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">
                      {fmtNum(dealsSummary.revenueAed)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.summaryTotalProfit")}</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--color-accent)]">
                      {fmtNum(dealsSummary.totalProfit)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <div className="text-xs uppercase text-muted">{t("reports.summaryAvgProfit")}</div>
                    <div className="mt-1 text-xl font-semibold text-app">
                      {fmtNum(dealsSummary.avgProfit)}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-app surface overflow-hidden">
                  <div className="responsive-table-wrap">
                    <table className="min-w-[640px] w-full text-left text-xs">
                      <thead className="border-b border-app text-muted">
                        <tr>
                          <th className="px-4 py-3">{t("reports.client")}</th>
                          <th className="px-4 py-3">{t("reports.car")}</th>
                          <th className="px-4 py-3">{t("reports.date")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.saleDzd")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.rateCol")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.saleAed")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.expensesCol")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.profitCol")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.collectedCol")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.pendingCol")}</th>
                          <th className="px-4 py-3">{t("reports.status")}</th>
                          <th className="px-4 py-3">{t("reports.lifecycleCol")}</th>
                          <th className="px-4 py-3">{t("reports.sourceCol")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dealsFiltered.map((d) => {
                          const usdPerAed = usdPerAedFromAppUsdSetting(rates?.USD ?? 0);
                          const rateCell = dealRateDzdPerAedForReport(d, usdPerAed);
                          const src = d.source ?? "STOCK";
                          const sourceText =
                            src === "STOCK"
                              ? t("reports.dealSourceStock")
                              : src === "PRE_ORDER_CATALOG"
                                ? t("reports.dealSourcePreOrderCatalog")
                                : src === "PRE_ORDER_CUSTOM"
                                  ? t("reports.dealSourcePreOrderCustom")
                                  : src;
                          return (
                          <tr key={d.id} className="border-b border-app last:border-b-0">
                            <td className="px-4 py-3 text-app">{d.client_name ?? cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{d.car_label ?? cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{fmtDateCell(d.date)}</td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(dealListSaleDzd(d) || 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-app">
                              {rateCell > 0 ? fmtNum(rateCell) : cellEmpty}
                            </td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(d.sale_aed_derived ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(dealTotalExpensesAed(d))}
                            </td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(d.profit_aed ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(d.collected_dzd ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtNum(d.pending_dzd ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-app">{dealStatusLabel(t, d.status) || d.status || cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{dealLifecycleLabel(t, d.lifecycle_status) || d.lifecycle_status || cellEmpty}</td>
                            <td className="px-4 py-3 text-app">{sourceText}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "cashflow" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t("reports.periodFrom")}
                    <input
                      type="date"
                      value={cfFrom}
                      onChange={(e) => setCfFrom(e.target.value)}
                      className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t("reports.periodTo")}
                    <input
                      type="date"
                      value={cfTo}
                      onChange={(e) => setCfTo(e.target.value)}
                      className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                  <Button type="button" variant="primary" size="sm" onPress={exportCashFlow}>
                    {t("reports.exportToExcel")}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
                  {POCKETS.map((p) => (
                    <div
                      key={p}
                      className="rounded-lg border border-app surface p-4"
                    >
                      <div className="text-xs uppercase text-muted">{pocketDetailLabel(t, p)}</div>
                      <div className="mt-1 text-lg font-semibold text-app">
                        {fmtMoney(pocketBalances[p]?.amount ?? 0, pocketBalances[p]?.currency ?? "AED")}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="rounded-lg border border-app surface p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                      {t("reports.aedCashFlow")}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs uppercase text-gray-400">{t("reports.incomeAed")}</div>
                        <div className="mt-1 text-lg font-semibold text-emerald-400">
                          {fmtMoney(cfByCurrency.aed.income, "AED")}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-400">{t("reports.expensesAed")}</div>
                        <div className="mt-1 text-lg font-semibold text-red-400">
                          {fmtMoney(cfByCurrency.aed.expenses, "AED")}
                        </div>
                      </div>
                      <div className="col-span-2 border-t border-app pt-2">
                        <div className="text-xs uppercase text-gray-400">{t("reports.netAed")}</div>
                        <div className="mt-1 text-lg font-semibold text-app">
                          {fmtMoney(cfByCurrency.aed.income - cfByCurrency.aed.expenses, "AED")}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-app surface p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                      {t("reports.dzdCashFlow")}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs uppercase text-gray-400">{t("reports.incomeDzd")}</div>
                        <div className="mt-1 text-lg font-semibold text-emerald-400">
                          {fmtMoney(cfByCurrency.dzd.income, "DZD")}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-400">{t("reports.expensesDzd")}</div>
                        <div className="mt-1 text-lg font-semibold text-red-400">
                          {fmtMoney(cfByCurrency.dzd.expenses, "DZD")}
                        </div>
                      </div>
                      <div className="col-span-2 border-t border-app pt-2">
                        <div className="text-xs uppercase text-gray-400">{t("reports.netDzd")}</div>
                        <div className="mt-1 text-lg font-semibold text-app">
                          {fmtMoney(cfByCurrency.dzd.income - cfByCurrency.dzd.expenses, "DZD")}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-app surface overflow-hidden">
                  <h3 className="border-b border-app px-4 py-3 text-sm font-semibold text-app">
                    {t("reports.movementsSection")}
                  </h3>
                  <div className="responsive-table-wrap max-h-[400px] overflow-y-auto">
                    <table className="min-w-[620px] w-full text-left text-xs">
                      <thead className="border-b border-app text-muted sticky top-0 surface">
                        <tr>
                          <th className="px-4 py-3">{t("reports.date")}</th>
                          <th className="px-4 py-3">{t("reports.movementColType")}</th>
                          <th className="px-4 py-3">{t("reports.movementColCategory")}</th>
                          <th className="px-4 py-3 text-right">{t("reports.amountCol")}</th>
                          <th className="px-4 py-3">{t("reports.pocketCol")}</th>
                          <th className="px-4 py-3">{t("reports.movementColDescription")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cfFilteredMovements.map((m) => (
                          <tr key={m.id} className="border-b border-app last:border-b-0">
                            <td className="px-4 py-3 text-app">{fmtDateCell(m.date)}</td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  (m.type || "").toLowerCase() === "in"
                                    ? "text-emerald-400"
                                    : "text-red-400"
                                }
                              >
                                {movementTypeLabel(t, m.type) || m.type || cellEmpty}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-app">{movementCategoryLabel(t, m.category) || m.category || cellEmpty}</td>
                            <td className="px-4 py-3 text-right text-app">
                              {fmtMoney(m.amount ?? 0, m.currency ?? "")}
                            </td>
                            <td className="px-4 py-3 text-app">{m.pocket ? pocketDetailLabel(t, m.pocket) : cellEmpty}</td>
                            <td className="px-4 py-3 text-app max-w-[200px] truncate">
                              {m.description ?? cellEmpty}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </PageContainer>
    </div>
  );
}
