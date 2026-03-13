"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Car, Deal, Movement, Rent } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx-js-style";
import { getRates, type AppRates } from "@/lib/rates";

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

const POCKETS = ["Dubai Cash", "Dubai Bank", "Algeria Cash", "Algeria Bank", "Qatar"];

const PL_EXPENSE_BREAKDOWN: { label: string; key: keyof Deal }[] = [
  { label: "Car Purchase", key: "cost_car" },
  { label: "Shipping", key: "cost_shipping" },
  { label: "Inspection", key: "cost_inspection" },
  { label: "Recovery", key: "cost_recovery" },
  { label: "Maintenance", key: "cost_maintenance" },
  { label: "Other", key: "cost_other" },
];

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined
): string {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const c = currency || "AED";
  return `${formatNumber(v)}${c ? ` ${c}` : ""}`;
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

function getAedAmount(m: Movement): number {
  if (m.currency === "AED" || !m.currency) return m.amount || 0;
  if (m.aed_equivalent != null) return m.aed_equivalent;
  const rate = m.rate || 0;
  return (m.amount || 0) * rate;
}

function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(workbook, filename);
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<"P&L" | "Inventory" | "Deals" | "Cash Flow">("P&L");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deals, setDeals] = useState<Deal[]>([]);
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

  const [invLocation, setInvLocation] = useState<string>("All");
  const [invStatus, setInvStatus] = useState<string>("All");

  const [dealsStatus, setDealsStatus] = useState<string>("All");
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
    setDeals((dealsData as Deal[]) ?? []);
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

  const plRevenue = useMemo(
    () => plFilteredDeals.reduce((s, d) => s + (d.sale_aed || 0), 0),
    [plFilteredDeals]
  );

  const plTotalExpenses = useMemo(
    () => plFilteredDeals.reduce((s, d) => s + (d.total_expenses || 0), 0),
    [plFilteredDeals]
  );

  const plGrossProfit = useMemo(
    () => plFilteredDeals.reduce((s, d) => s + (d.profit || 0), 0),
    [plFilteredDeals]
  );

  const plExpensesByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    PL_EXPENSE_BREAKDOWN.forEach(({ label }) => (map[label] = 0));
    plFilteredDeals.forEach((d) => {
      PL_EXPENSE_BREAKDOWN.forEach(({ label, key }) => {
        map[label] += (d[key] as number) || 0;
      });
    });
    return map;
  }, [plFilteredDeals]);

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

  const plMonthsInPeriod = useMemo(() => {
    const from = new Date(plFrom);
    const to = new Date(plTo);
    return Math.max(
      1,
      (to.getFullYear() - from.getFullYear()) * 12 +
        (to.getMonth() - from.getMonth()) +
        1
    );
  }, [plFrom, plTo]);

  const plRentExpense = useMemo(() => {
    if (!rates) return 0;
    return plActiveRentsInPeriod.reduce((sum, r) => {
      const monthlyBase = (r.annual_amount || 0) / 12;
      const currency = (r.currency || "AED").toUpperCase();
      let monthlyAed = 0;
      if (currency === "AED") {
        monthlyAed = monthlyBase;
      } else if (currency === "DZD" && rates.DZD > 0) {
        // rate_DZD is DZD per 1 AED, so convert DZD → AED by dividing
        monthlyAed = monthlyBase / rates.DZD;
      }
      return sum + monthlyAed * plMonthsInPeriod;
    }, 0);
  }, [plActiveRentsInPeriod, plMonthsInPeriod, rates]);
  const plTotalExpensesWithRent = plTotalExpenses + plRentExpense;
  const plGrossProfitWithRent = plRevenue - plTotalExpensesWithRent;
  const plMargin =
    plRevenue > 0 ? (plGrossProfitWithRent / plRevenue) * 100 : 0;

  const invFilteredCars = useMemo(() => {
    return cars.filter((c) => {
      if (invLocation !== "All" && (c.location || "") !== invLocation)
        return false;
      if (invStatus !== "All" && (c.status || "").toLowerCase() !== invStatus.toLowerCase())
        return false;
      return true;
    });
  }, [cars, invLocation, invStatus]);

  const invSummary = useMemo(() => {
    const total = cars.length;
    const available = cars.filter(
      (c) => (c.status || "").toLowerCase() === "available"
    ).length;
    const sold = cars.filter(
      (c) => (c.status || "").toLowerCase() === "sold"
    ).length;
    const inTransit = cars.filter(
      (c) => (c.location || "").toLowerCase().includes("transit")
    ).length;
    let totalValue = 0;
    cars
      .filter((c) => (c.status || "").toLowerCase() === "available")
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
      if (dealsStatus !== "All" && (d.status || "").toLowerCase() !== dealsStatus.toLowerCase())
        return false;
      const date = d.date || "";
      return date >= dealsFrom && date <= dealsTo;
    });
  }, [deals, dealsStatus, dealsFrom, dealsTo]);

  const dealsSummary = useMemo(() => {
    const total = dealsFiltered.length;
    const revenueDzd = dealsFiltered.reduce((s, d) => s + (d.sale_dzd || 0), 0);
    const revenueAed = dealsFiltered.reduce((s, d) => s + (d.sale_aed || 0), 0);
    const totalProfit = dealsFiltered.reduce((s, d) => s + (d.profit || 0), 0);
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
    const data: (string | number)[][] = [
      ["AXIRA TRADING FZE"],
      ["Profit & Loss Report", `${plFrom} to ${plTo}`],
      [],
      ["Total Revenue AED", plRevenue],
      ["Total Expenses AED", plTotalExpensesWithRent],
      ["Gross Profit AED", plGrossProfitWithRent],
      ["Profit Margin %", plMargin],
      [],
      ["EXPENSES BREAKDOWN"],
      ...PL_EXPENSE_BREAKDOWN.map(({ label }) => [label, plExpensesByCategory[label] ?? 0]),
      ...plActiveRentsInPeriod
        .map((r) => {
          if (!rates) return null;
          const monthlyBase = (r.annual_amount || 0) / 12;
          const currency = (r.currency || "AED").toUpperCase();
          let monthlyAed = 0;
          let label = "";

          if (currency === "AED") {
            monthlyAed = monthlyBase;
            label = `Rent - ${r.description || "—"}: ${formatNumber(
              monthlyAed
            )} AED`;
          } else if (currency === "DZD" && rates.DZD > 0) {
            monthlyAed = monthlyBase / rates.DZD;
            label = `Rent - ${r.description || "—"}: ${formatNumber(
              monthlyAed
            )} AED (${formatNumber(monthlyBase)} DZD at current rate)`;
          } else {
            return null;
          }

          return [label, monthlyAed * plMonthsInPeriod] as [string, number];
        })
        .filter(Boolean) as (string | number)[][],
      [],
      ["DEALS"],
      ["Client", "Car", "Date", "Sale DZD", "Rate", "Sale AED", "Expenses", "Profit", "Status"],
      ...plFilteredDeals.map((d) => [
        d.client_name ?? "",
        d.car_label ?? "",
        d.date ?? "",
        d.sale_dzd ?? 0,
        d.rate ?? 0,
        d.sale_aed ?? 0,
        d.total_expenses ?? 0,
        d.profit ?? 0,
        d.status ?? "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);

    const headerStyle: CellStyle = {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    };
    setCellValueAndStyle(ws, 0, 0, "AXIRA TRADING FZE", headerStyle);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];

    setCellValueAndStyle(ws, 1, 0, "Profit & Loss Report", {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, `${plFrom} to ${plTo}`, {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });

    setCellValueAndStyle(ws, 3, 0, "Total Revenue AED", { font: { bold: true } });
    setCellValueAndStyle(ws, 3, 1, plRevenue, { numFmt: "#,##0" });
    setCellValueAndStyle(ws, 4, 0, "Total Expenses AED", { font: { bold: true } });
    setCellValueAndStyle(ws, 4, 1, plTotalExpensesWithRent, { numFmt: "#,##0" });
    setCellValueAndStyle(ws, 5, 0, "Gross Profit AED", { font: { bold: true } });
    setCellValueAndStyle(ws, 5, 1, plGrossProfitWithRent, {
      numFmt: "#,##0",
      font: { bold: true, color: { rgb: plGrossProfitWithRent >= 0 ? GREEN : RED } },
    });
    setCellValueAndStyle(ws, 6, 0, "Profit Margin %", { font: { bold: true } });
    setCellValueAndStyle(ws, 6, 1, plMargin, { numFmt: "0.00%" });

    const expenseHeaderRow = 8;
    setCellValueAndStyle(ws, expenseHeaderRow, 0, "EXPENSES BREAKDOWN", {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: expenseHeaderRow, c: 0 }, e: { r: expenseHeaderRow, c: 2 } }];
    PL_EXPENSE_BREAKDOWN.forEach(({ label }, i) => {
      const r = expenseHeaderRow + 1 + i;
      setCellValueAndStyle(
        ws,
        r,
        0,
        label,
        i % 2 === 0 ? {} : { fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" } }
      );
      setCellValueAndStyle(ws, r, 1, plExpensesByCategory[label] ?? 0, {
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
        label = `Rent - ${r.description || "—"}: ${formatNumber(monthlyAed)} AED`;
      } else if (currency === "DZD" && rates.DZD > 0) {
        monthlyAed = monthlyBase / rates.DZD;
        label = `Rent - ${r.description || "—"}: ${formatNumber(
          monthlyAed
        )} AED (${formatNumber(monthlyBase)} DZD at current rate)`;
      } else {
        return;
      }

      const rentRow = expenseHeaderRow + 1 + PL_EXPENSE_BREAKDOWN.length + i;
      setCellValueAndStyle(ws, rentRow, 0, label, {
        fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
      });
      setCellValueAndStyle(ws, rentRow, 1, monthlyAed * plMonthsInPeriod, {
        numFmt: "#,##0",
        fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
      });
    });

    const dealsHeaderRow =
      expenseHeaderRow + 1 + PL_EXPENSE_BREAKDOWN.length + plActiveRentsInPeriod.length + 1;
    setCellValueAndStyle(ws, dealsHeaderRow, 0, "DEALS", {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: dealsHeaderRow, c: 0 }, e: { r: dealsHeaderRow, c: maxCol } }];
    const dealColHeaders = ["Client", "Car", "Date", "Sale DZD", "Rate", "Sale AED", "Expenses", "Profit", "Status"];
    dealColHeaders.forEach((h, c) => setCellValueAndStyle(ws, dealsHeaderRow + 1, c, h, { font: { bold: true } }));
    plFilteredDeals.forEach((d, i) => {
      const r = dealsHeaderRow + 2 + i;
      const row = [
        d.client_name ?? "",
        d.car_label ?? "",
        d.date ?? "",
        d.sale_dzd ?? 0,
        d.rate ?? 0,
        d.sale_aed ?? 0,
        d.total_expenses ?? 0,
        d.profit ?? 0,
        d.status ?? "",
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
    XLSX.utils.book_append_sheet(wb, ws, "P&L");
    downloadWorkbook(wb, `PnL_${plFrom}_${plTo}.xlsx`);
  }, [
    plFrom,
    plTo,
    plRevenue,
    plTotalExpensesWithRent,
    plGrossProfitWithRent,
    plActiveRentsInPeriod,
    plMonthsInPeriod,
    plMargin,
    plExpensesByCategory,
    plFilteredDeals,
    rates,
  ]);

  const exportInventory = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const cols = ["Brand", "Model", "Year", "Color", "Mileage", "Location", "Owner", "Purchase Price", "Status"];
    const data: (string | number | null)[][] = [
      ["AXIRA TRADING FZE"],
      ["Inventory Report", new Date().toISOString().slice(0, 10)],
      [],
      cols,
      ...invFilteredCars.map((c) => [
        c.brand ?? "",
        c.model ?? "",
        c.year ?? "",
        c.color ?? "",
        c.mileage ?? "",
        c.location ?? "",
        c.owner ?? "",
        c.purchase_price ?? "",
        c.status ?? "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const maxCol = cols.length - 1;
    setCellValueAndStyle(ws, 0, 0, "AXIRA TRADING FZE", {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];
    setCellValueAndStyle(ws, 1, 0, "Inventory Report", {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, new Date().toISOString().slice(0, 10), {
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
        c.location ?? "",
        c.owner ?? "",
        c.purchase_price ?? "",
        c.status ?? "",
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
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    downloadWorkbook(wb, `Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [invFilteredCars]);

  const exportDeals = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const cols = [
      "Client",
      "Car",
      "Date",
      "Sale DZD",
      "Rate",
      "Sale AED",
      "Expenses",
      "Profit",
      "Collected DZD",
      "Pending DZD",
      "Status",
    ];
    const data: (string | number | null)[][] = [
      ["AXIRA TRADING FZE"],
      ["Deals Report", `${dealsFrom} to ${dealsTo}`],
      [],
      cols,
      ...dealsFiltered.map((d) => [
        d.client_name ?? "",
        d.car_label ?? "",
        d.date ?? "",
        d.sale_dzd ?? 0,
        d.rate ?? 0,
        d.sale_aed ?? 0,
        d.total_expenses ?? 0,
        d.profit ?? 0,
        d.collected_dzd ?? 0,
        d.pending_dzd ?? 0,
        d.status ?? "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const maxCol = cols.length - 1;
    setCellValueAndStyle(ws, 0, 0, "AXIRA TRADING FZE", {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];
    setCellValueAndStyle(ws, 1, 0, "Deals Report", {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, `${dealsFrom} to ${dealsTo}`, {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    cols.forEach((h, c) => setCellValueAndStyle(ws, 3, c, h, { font: { bold: true } }));
    const profitColIdx = 7;
    dealsFiltered.forEach((d, i) => {
      const r = 4 + i;
      const row = [
        d.client_name ?? "",
        d.car_label ?? "",
        d.date ?? "",
        d.sale_dzd ?? 0,
        d.rate ?? 0,
        d.sale_aed ?? 0,
        d.total_expenses ?? 0,
        d.profit ?? 0,
        d.collected_dzd ?? 0,
        d.pending_dzd ?? 0,
        d.status ?? "",
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
    XLSX.utils.book_append_sheet(wb, ws, "Deals");
    downloadWorkbook(wb, `Deals_${dealsFrom}_${dealsTo}.xlsx`);
  }, [dealsFiltered, dealsFrom, dealsTo]);

  const exportCashFlow = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const data: (string | number)[][] = [
      ["AXIRA TRADING FZE"],
      ["Cash Flow Report", `${cfFrom} to ${cfTo}`],
      [],
      ["Pocket Balances"],
      ["Pocket", "Amount", "Currency"],
      ...POCKETS.map((p) => [
        p,
        pocketBalances[p]?.amount ?? 0,
        pocketBalances[p]?.currency ?? "",
      ]),
      [],
      ["AED Cash Flow", ""],
      ["Income AED", cfByCurrency.aed.income],
      ["Expenses AED", cfByCurrency.aed.expenses],
      ["Net AED", cfByCurrency.aed.income - cfByCurrency.aed.expenses],
      [],
      ["DZD Cash Flow", ""],
      ["Income DZD", cfByCurrency.dzd.income],
      ["Expenses DZD", cfByCurrency.dzd.expenses],
      ["Net DZD", cfByCurrency.dzd.income - cfByCurrency.dzd.expenses],
      [],
      ["Movements"],
      ["Date", "Type", "Category", "Amount", "Currency", "Pocket", "Description"],
      ...cfFilteredMovements.map((m) => [
        m.date ?? "",
        m.type ?? "",
        m.category ?? "",
        m.amount ?? 0,
        m.currency ?? "",
        m.pocket ?? "",
        m.description ?? "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const maxCol = 6;
    setCellValueAndStyle(ws, 0, 0, "AXIRA TRADING FZE", {
      font: { bold: true, color: { rgb: WHITE }, sz: 18 },
      fill: { fgColor: { rgb: ACCENT_RED }, patternType: "solid" },
    });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }];
    setCellValueAndStyle(ws, 1, 0, "Cash Flow Report", {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 1, 1, `${cfFrom} to ${cfTo}`, {
      font: { bold: true },
      fill: { fgColor: { rgb: LIGHT_GRAY }, patternType: "solid" },
    });
    setCellValueAndStyle(ws, 3, 0, "Pocket Balances", {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }];
    setCellValueAndStyle(ws, 4, 0, "Pocket", { font: { bold: true } });
    setCellValueAndStyle(ws, 4, 1, "Amount", { font: { bold: true } });
    setCellValueAndStyle(ws, 4, 2, "Currency", { font: { bold: true } });
    POCKETS.forEach((p, i) => {
      setCellValueAndStyle(ws, 5 + i, 0, p);
      setCellValueAndStyle(ws, 5 + i, 1, pocketBalances[p]?.amount ?? 0, { numFmt: "#,##0" });
      setCellValueAndStyle(ws, 5 + i, 2, pocketBalances[p]?.currency ?? "");
    });
    const summaryStart = 5 + POCKETS.length + 2;
    setCellValueAndStyle(ws, summaryStart, 0, "AED Cash Flow", { font: { bold: true } });
    setCellValueAndStyle(ws, summaryStart + 1, 0, "Income AED");
    setCellValueAndStyle(ws, summaryStart + 1, 1, cfByCurrency.aed.income, {
      numFmt: "#,##0",
      font: { color: { rgb: GREEN } },
    });
    setCellValueAndStyle(ws, summaryStart + 2, 0, "Expenses AED");
    setCellValueAndStyle(ws, summaryStart + 2, 1, cfByCurrency.aed.expenses, {
      numFmt: "#,##0",
      font: { color: { rgb: RED } },
    });
    setCellValueAndStyle(ws, summaryStart + 3, 0, "Net AED");
    setCellValueAndStyle(ws, summaryStart + 3, 1, cfByCurrency.aed.income - cfByCurrency.aed.expenses, {
      numFmt: "#,##0",
    });
    setCellValueAndStyle(ws, summaryStart + 5, 0, "DZD Cash Flow", { font: { bold: true } });
    setCellValueAndStyle(ws, summaryStart + 6, 0, "Income DZD");
    setCellValueAndStyle(ws, summaryStart + 6, 1, cfByCurrency.dzd.income, {
      numFmt: "#,##0",
      font: { color: { rgb: GREEN } },
    });
    setCellValueAndStyle(ws, summaryStart + 7, 0, "Expenses DZD");
    setCellValueAndStyle(ws, summaryStart + 7, 1, cfByCurrency.dzd.expenses, {
      numFmt: "#,##0",
      font: { color: { rgb: RED } },
    });
    setCellValueAndStyle(ws, summaryStart + 8, 0, "Net DZD");
    setCellValueAndStyle(ws, summaryStart + 8, 1, cfByCurrency.dzd.income - cfByCurrency.dzd.expenses, {
      numFmt: "#,##0",
    });
    const moveHeaderRow = summaryStart + 10;
    setCellValueAndStyle(ws, moveHeaderRow, 0, "Movements", {
      font: { bold: true, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: DARK_GRAY }, patternType: "solid" },
    });
    ws["!merges"] = [...(ws["!merges"] || []), { s: { r: moveHeaderRow, c: 0 }, e: { r: moveHeaderRow, c: maxCol } }];
    ["Date", "Type", "Category", "Amount", "Currency", "Pocket", "Description"].forEach((h, c) =>
      setCellValueAndStyle(ws, moveHeaderRow + 1, c, h, { font: { bold: true } })
    );
    cfFilteredMovements.forEach((m, i) => {
      const r = moveHeaderRow + 2 + i;
      const row = [
        m.date ?? "",
        m.type ?? "",
        m.category ?? "",
        m.amount ?? 0,
        m.currency ?? "",
        m.pocket ?? "",
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
    XLSX.utils.book_append_sheet(wb, ws, "Cash Flow");
    downloadWorkbook(wb, `CashFlow_${cfFrom}_${cfTo}.xlsx`);
  }, [pocketBalances, cfFilteredMovements, cfByCurrency, cfFrom, cfTo]);

  const tabs = ["P&L", "Inventory", "Deals", "Cash Flow"] as const;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Reports
          </h1>
          <p className="text-sm font-medium text-[#c0392b]">
            P&L, Inventory, Deals &amp; Cash Flow
          </p>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-[#222222] pb-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab
                  ? "border-[#c0392b] bg-[#c0392b]/15 text-white"
                  : "border-[#222222] bg-[#111111] text-zinc-300 hover:border-[#c0392b]/70"
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

        {isLoading ? (
          <div className="rounded-lg border border-[#222222] bg-[#111111] p-8 text-center text-zinc-400">
            Loading reports...
          </div>
        ) : (
          <>
            {activeTab === "P&L" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    From
                    <input
                      type="date"
                      value={plFrom}
                      onChange={(e) => setPlFrom(e.target.value)}
                      className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    To
                    <input
                      type="date"
                      value={plTo}
                      onChange={(e) => setPlTo(e.target.value)}
                      className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={exportPl}
                    className="rounded-md bg-[#c0392b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Export to Excel
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total Revenue AED</div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      {formatNumber(plRevenue)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total Expenses AED</div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      {formatNumber(plTotalExpensesWithRent)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Gross Profit AED</div>
                    <div className="mt-1 text-xl font-semibold text-[#c0392b]">
                      {formatNumber(plGrossProfitWithRent)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Profit Margin %</div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      {plMargin.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] overflow-hidden">
                  <h3 className="border-b border-[#222222] px-4 py-3 text-sm font-semibold text-zinc-200">
                    Expenses breakdown (AED)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#222222] text-zinc-400">
                        <tr>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PL_EXPENSE_BREAKDOWN.map(({ label }) => (
                          <tr key={label} className="border-b border-[#222222] last:border-b-0">
                            <td className="px-4 py-3 text-zinc-200">{label}</td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(plExpensesByCategory[label] ?? 0)}
                            </td>
                          </tr>
                        ))}
                        {plActiveRentsInPeriod.map((r) => {
                          if (!rates) return null;
                          const monthlyBase = (r.annual_amount || 0) / 12;
                          const currency = (r.currency || "AED").toUpperCase();
                          let monthlyAed = 0;
                          let label = "";

                          if (currency === "AED") {
                            monthlyAed = monthlyBase;
                            label = `Rent - ${r.description || "—"}: ${formatNumber(
                              monthlyAed
                            )} AED`;
                          } else if (currency === "DZD" && rates.DZD > 0) {
                            monthlyAed = monthlyBase / rates.DZD;
                            label = `Rent - ${r.description || "—"}: ${formatNumber(
                              monthlyAed
                            )} AED (${formatNumber(
                              monthlyBase
                            )} DZD at current rate)`;
                          } else {
                            // Unsupported or missing rate; skip from AED breakdown
                            return null;
                          }

                          const periodAmountAed = monthlyAed * plMonthsInPeriod;

                          return (
                            <tr key={r.id} className="border-b border-[#222222] last:border-b-0">
                              <td className="px-4 py-3 text-zinc-200">{label}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">
                                {formatNumber(periodAmountAed)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] overflow-hidden">
                  <h3 className="border-b border-[#222222] px-4 py-3 text-sm font-semibold text-zinc-200">
                    Deals with profit
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-[700px] w-full text-left text-xs">
                      <thead className="border-b border-[#222222] text-zinc-400">
                        <tr>
                          <th className="px-4 py-3">Client</th>
                          <th className="px-4 py-3">Car</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3 text-right">Sale AED</th>
                          <th className="px-4 py-3 text-right">Profit AED</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plFilteredDeals.map((d) => (
                          <tr key={d.id} className="border-b border-[#222222] last:border-b-0">
                            <td className="px-4 py-3 text-zinc-200">{d.client_name ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{d.car_label ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{formatDate(d.date)}</td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.sale_aed ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.profit ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Inventory" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-4">
                  <select
                    value={invLocation}
                    onChange={(e) => setInvLocation(e.target.value)}
                    className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                  >
                    <option value="All">All locations</option>
                    <option value="Dubai Showroom">Dubai Showroom</option>
                    <option value="Algeria Showroom">Algeria Showroom</option>
                    <option value="In Transit">In Transit</option>
                  </select>
                  <select
                    value={invStatus}
                    onChange={(e) => setInvStatus(e.target.value)}
                    className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                  >
                    <option value="All">All statuses</option>
                    <option value="available">Available</option>
                    <option value="sold">Sold</option>
                  </select>
                  <button
                    type="button"
                    onClick={exportInventory}
                    className="rounded-md bg-[#c0392b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Export to Excel
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total cars</div>
                    <div className="mt-1 text-xl font-semibold text-white">{invSummary.total}</div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Available</div>
                    <div className="mt-1 text-xl font-semibold text-white">{invSummary.available}</div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Sold</div>
                    <div className="mt-1 text-xl font-semibold text-white">{invSummary.sold}</div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">In Transit</div>
                    <div className="mt-1 text-xl font-semibold text-white">{invSummary.inTransit}</div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total inventory value AED</div>
                    <div className="mt-1 text-xl font-semibold text-[#c0392b]">
                      {formatNumber(invSummary.totalValue)}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-[900px] w-full text-left text-xs">
                      <thead className="border-b border-[#222222] text-zinc-400">
                        <tr>
                          <th className="px-4 py-3">Brand</th>
                          <th className="px-4 py-3">Model</th>
                          <th className="px-4 py-3">Year</th>
                          <th className="px-4 py-3">Price</th>
                          <th className="px-4 py-3">Location</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Client</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invFilteredCars.map((c) => (
                          <tr key={c.id} className="border-b border-[#222222] last:border-b-0">
                            <td className="px-4 py-3 text-zinc-200">{c.brand ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{c.model ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{c.year ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">
                              {c.purchase_price != null ? formatNumber(c.purchase_price) : "-"}
                            </td>
                            <td className="px-4 py-3 text-zinc-200">{c.location ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{c.status ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{c.client_name ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Deals" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-end gap-4">
                  <select
                    value={dealsStatus}
                    onChange={(e) => setDealsStatus(e.target.value)}
                    className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                  >
                    <option value="All">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="closed">Closed</option>
                  </select>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    From
                    <input
                      type="date"
                      value={dealsFrom}
                      onChange={(e) => setDealsFrom(e.target.value)}
                      className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    To
                    <input
                      type="date"
                      value={dealsTo}
                      onChange={(e) => setDealsTo(e.target.value)}
                      className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={exportDeals}
                    className="rounded-md bg-[#c0392b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Export to Excel
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total deals</div>
                    <div className="mt-1 text-xl font-semibold text-white">{dealsSummary.total}</div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total revenue DZD</div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      {formatNumber(dealsSummary.revenueDzd)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total revenue AED</div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      {formatNumber(dealsSummary.revenueAed)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Total profit</div>
                    <div className="mt-1 text-xl font-semibold text-[#c0392b]">
                      {formatNumber(dealsSummary.totalProfit)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <div className="text-xs uppercase text-zinc-400">Avg profit per deal</div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      {formatNumber(dealsSummary.avgProfit)}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-[1000px] w-full text-left text-xs">
                      <thead className="border-b border-[#222222] text-zinc-400">
                        <tr>
                          <th className="px-4 py-3">Client</th>
                          <th className="px-4 py-3">Car</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3 text-right">Sale DZD</th>
                          <th className="px-4 py-3 text-right">Rate</th>
                          <th className="px-4 py-3 text-right">Sale AED</th>
                          <th className="px-4 py-3 text-right">Expenses</th>
                          <th className="px-4 py-3 text-right">Profit</th>
                          <th className="px-4 py-3 text-right">Collected</th>
                          <th className="px-4 py-3 text-right">Pending</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dealsFiltered.map((d) => (
                          <tr key={d.id} className="border-b border-[#222222] last:border-b-0">
                            <td className="px-4 py-3 text-zinc-200">{d.client_name ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{d.car_label ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200">{formatDate(d.date)}</td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.sale_dzd ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {d.rate ?? "-"}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.sale_aed ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.total_expenses ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.profit ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.collected_dzd ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatNumber(d.pending_dzd ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-zinc-200">{d.status ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Cash Flow" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    From
                    <input
                      type="date"
                      value={cfFrom}
                      onChange={(e) => setCfFrom(e.target.value)}
                      className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    To
                    <input
                      type="date"
                      value={cfTo}
                      onChange={(e) => setCfTo(e.target.value)}
                      className="rounded-md border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={exportCashFlow}
                    className="rounded-md bg-[#c0392b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Export to Excel
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
                  {POCKETS.map((p) => (
                    <div
                      key={p}
                      className="rounded-lg border border-[#222222] bg-[#111111] p-4"
                    >
                      <div className="text-xs uppercase text-zinc-400">{p}</div>
                      <div className="mt-1 text-lg font-semibold text-white">
                        {formatMoney(pocketBalances[p]?.amount ?? 0, pocketBalances[p]?.currency ?? "AED")}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                      AED Cash Flow
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs uppercase text-zinc-500">Income AED</div>
                        <div className="mt-1 text-lg font-semibold text-emerald-400">
                          {formatMoney(cfByCurrency.aed.income, "AED")}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-zinc-500">Expenses AED</div>
                        <div className="mt-1 text-lg font-semibold text-red-400">
                          {formatMoney(cfByCurrency.aed.expenses, "AED")}
                        </div>
                      </div>
                      <div className="col-span-2 border-t border-[#222222] pt-2">
                        <div className="text-xs uppercase text-zinc-500">Net AED</div>
                        <div className="mt-1 text-lg font-semibold text-white">
                          {formatMoney(cfByCurrency.aed.income - cfByCurrency.aed.expenses, "AED")}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#222222] bg-[#111111] p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                      DZD Cash Flow
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs uppercase text-zinc-500">Income DZD</div>
                        <div className="mt-1 text-lg font-semibold text-emerald-400">
                          {formatMoney(cfByCurrency.dzd.income, "DZD")}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-zinc-500">Expenses DZD</div>
                        <div className="mt-1 text-lg font-semibold text-red-400">
                          {formatMoney(cfByCurrency.dzd.expenses, "DZD")}
                        </div>
                      </div>
                      <div className="col-span-2 border-t border-[#222222] pt-2">
                        <div className="text-xs uppercase text-zinc-500">Net DZD</div>
                        <div className="mt-1 text-lg font-semibold text-white">
                          {formatMoney(cfByCurrency.dzd.income - cfByCurrency.dzd.expenses, "DZD")}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-[#222222] bg-[#111111] overflow-hidden">
                  <h3 className="border-b border-[#222222] px-4 py-3 text-sm font-semibold text-zinc-200">
                    Movements
                  </h3>
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="min-w-[800px] w-full text-left text-xs">
                      <thead className="border-b border-[#222222] text-zinc-400 sticky top-0 bg-[#111111]">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3 text-right">Amount</th>
                          <th className="px-4 py-3">Pocket</th>
                          <th className="px-4 py-3">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cfFilteredMovements.map((m) => (
                          <tr key={m.id} className="border-b border-[#222222] last:border-b-0">
                            <td className="px-4 py-3 text-zinc-200">{formatDate(m.date)}</td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  (m.type || "").toLowerCase() === "in"
                                    ? "text-emerald-400"
                                    : "text-red-400"
                                }
                              >
                                {m.type ?? "-"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-zinc-200">{m.category ?? "-"}</td>
                            <td className="px-4 py-3 text-right text-zinc-200">
                              {formatMoney(m.amount ?? 0, m.currency ?? "")}
                            </td>
                            <td className="px-4 py-3 text-zinc-200">{m.pocket ?? "-"}</td>
                            <td className="px-4 py-3 text-zinc-200 max-w-[200px] truncate">
                              {m.description ?? "-"}
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
      </div>
    </div>
  );
}
