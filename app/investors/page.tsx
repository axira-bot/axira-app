"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getRates, type AppRates } from "@/lib/rates";
import { useAuth } from "@/lib/context/AuthContext";

const CURRENCIES = ["AED", "DZD", "EUR", "USD"] as const;
const AED_POCKETS = ["Dubai Cash", "Dubai Bank", "Qatar"] as const;

type Investor = {
  id: string;
  name: string | null;
  investment_amount: number | null;
  original_amount?: number | null;
  original_currency?: string | null;
  currency: string | null;
  rate: number | null;
  investment_aed: number | null;
  profit_share_percent: number | null;
  investment_date: string | null;
  notes: string | null;
};

type InvestorReturn = {
  id: string;
  investor_id: string;
  month: string | null;
  total_profit: number | null;
  investor_share: number | null;
  status: string | null;
  paid_date: string | null;
};

type DealProfit = {
  id: string;
  date: string | null;
  profit: number | null;
};

type InvestorFormState = {
  name: string;
  investmentAmount: string;
  currency: (typeof CURRENCIES)[number];
  rate: string;
  investmentDate: string;
  profitSharePercent: string;
  notes: string;
};

const emptyForm = (): InvestorFormState => ({
  name: "",
  investmentAmount: "",
  currency: "AED",
  rate: "",
  investmentDate: new Date().toISOString().slice(0, 10),
  profitSharePercent: "0",
  notes: "",
});

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined, currency: string) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  return `${formatNumber(v)} ${currency || "AED"}`;
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

function monthFromDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function InvestorsPage() {
  const { canDelete, isInvestorReadOnly } = useAuth();
  const [activeTab, setActiveTab] = useState<"Investors" | "Returns" | "Owner">("Investors");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [investors, setInvestors] = useState<Investor[]>([]);
  const [returns, setReturns] = useState<InvestorReturn[]>([]);
  const [deals, setDeals] = useState<DealProfit[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InvestorFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [payPocket, setPayPocket] = useState<string>(AED_POCKETS[0]);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const [totalCapitalOverride, setTotalCapitalOverride] = useState<string>("");
  const [bonusInvestorId, setBonusInvestorId] = useState<string | null>(null);
  const [bonusAmount, setBonusAmount] = useState<string>("");
  const [bonusReason, setBonusReason] = useState<string>("");
  const [bonusDate, setBonusDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [bonusPocket, setBonusPocket] = useState<string>(AED_POCKETS[0]);
  const [isSavingBonus, setIsSavingBonus] = useState(false);
  const [rates, setRates] = useState<AppRates>({ DZD: 0, EUR: 0, USD: 0, GBP: 0 });
  const [ownerName, setOwnerName] = useState<string>("Rami");
  const [ownerCapital, setOwnerCapital] = useState<string>("");
  const [ownerCapitalCurrency, setOwnerCapitalCurrency] = useState<"AED" | "DZD" | "EUR" | "USD">("AED");
  const [businessValuation, setBusinessValuation] = useState<string>("");
  const [sharePrice, setSharePrice] = useState<string>("");
  const [totalShares, setTotalShares] = useState<string>("");
  const [availableShares, setAvailableShares] = useState<string>("");
  const [ownerNotes, setOwnerNotes] = useState<string>("");
  const [isSavingOwner, setIsSavingOwner] = useState(false);
  const [payOutReturn, setPayOutReturn] = useState<{
    investorId: string;
    month: string;
    totalProfit: number;
    investorShare: number;
  } | null>(null);
  const [payOutPocket, setPayOutPocket] = useState<string>(AED_POCKETS[0]);
  const [payOutDate, setPayOutDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [isSavingPayOut, setIsSavingPayOut] = useState(false);

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/investors", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        investors?: Investor[];
        returns?: InvestorReturn[];
        deals?: DealProfit[];
        settings?: Array<{ key: string; value: string | null }>;
        warnings?: { deals?: string | null; settings?: string | null };
      };
      if (!response.ok) {
        setError(payload.error ?? "Failed to load investors data");
        return;
      }

      if (payload.warnings?.deals) {
        console.warn("Investors page: deals lookup unavailable", payload.warnings.deals);
      }
      if (payload.warnings?.settings) {
        console.warn("Investors page: app settings unavailable", payload.warnings.settings);
      }

      setInvestors(payload.investors ?? []);
      setReturns(payload.returns ?? []);
      setDeals(payload.deals ?? []);
      if (payload.settings) {
        for (const row of payload.settings) {
          switch (row.key) {
            case "total_capital":
              setTotalCapitalOverride(row.value ?? "");
              break;
            case "owner_name":
              setOwnerName(row.value ?? "Rami");
              break;
            case "owner_capital":
              setOwnerCapital(row.value ?? "");
              break;
            case "owner_capital_currency":
              if (row.value === "AED" || row.value === "DZD" || row.value === "EUR" || row.value === "USD") {
                setOwnerCapitalCurrency(row.value);
              }
              break;
            case "business_valuation":
              setBusinessValuation(row.value ?? "");
              break;
            case "share_price":
              setSharePrice(row.value ?? "");
              break;
            case "total_shares":
              setTotalShares(row.value ?? "");
              break;
            case "available_shares":
              setAvailableShares(row.value ?? "");
              break;
            case "owner_notes":
              setOwnerNotes(row.value ?? "");
              break;
            default:
              break;
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    (async () => {
      const r = await getRates();
      setRates(r);
    })();
  }, []);

  const profitByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    deals.forEach((d) => {
      const m = monthFromDate(d.date);
      if (!m) return;
      map[m] = (map[m] ?? 0) + (d.profit ?? 0);
    });
    return map;
  }, [deals]);

  const monthsSorted = useMemo(() => Object.keys(profitByMonth).sort().reverse(), [profitByMonth]);

  const returnByKey = useMemo(() => {
    const map: Record<string, InvestorReturn> = {};
    returns.forEach((r) => {
      map[`${r.investor_id}-${r.month}`] = r;
    });
    return map;
  }, [returns]);

  const totalInvested = useMemo(
    () => investors.reduce((s, i) => s + (i.investment_aed ?? 0), 0),
    [investors]
  );
  const totalReturned = useMemo(
    () =>
      returns
        .filter((r) => (r.status || "").toLowerCase() === "paid")
        .reduce((s, r) => s + (r.investor_share ?? 0), 0),
    [returns]
  );
  const roiPercent = totalInvested > 0 ? (totalReturned / totalInvested) * 100 : 0;

  const effectiveTotalCapital = useMemo(() => {
    const override = parseNum(totalCapitalOverride);
    if (override > 0) return override;
    return totalInvested;
  }, [totalCapitalOverride, totalInvested]);

  const updateField = <K extends keyof InvestorFormState>(key: K, value: InvestorFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setIsModalOpen(true);
    setError(null);
  };

  const openEdit = (i: Investor) => {
    setEditingId(i.id);
    setForm({
      name: i.name ?? "",
      investmentAmount: String(i.investment_amount ?? ""),
      currency: (i.currency === "DZD" ? "DZD" : "AED") as (typeof CURRENCIES)[number],
      rate: i.rate != null ? String(i.rate) : "",
      investmentDate: (i.investment_date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      profitSharePercent: String(i.profit_share_percent ?? "0"),
      notes: i.notes ?? "",
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

  const investmentAedFromForm = useMemo(() => {
    const amt = parseNum(form.investmentAmount);
    const manualRate = parseNum(form.rate);
    if (!amt) return 0;
    if (form.currency === "AED") return amt;
    if (form.currency === "DZD") {
      const fx = rates.DZD;
      if (fx > 0) return amt / fx;
      return manualRate > 0 ? amt / manualRate : amt;
    }
    if (form.currency === "EUR" && rates.EUR > 0) return amt / rates.EUR;
    if (form.currency === "USD" && rates.USD > 0) return amt / rates.USD;
    return amt;
  }, [form.investmentAmount, form.currency, form.rate, rates]);

  const handleSave = async () => {
    if (isInvestorReadOnly) return;
    if (!form.name.trim()) {
      setError("Full name is required.");
      return;
    }
    const amount = parseNum(form.investmentAmount);
    const manualRate = parseNum(form.rate);
    let investmentAed = amount;
    if (form.currency === "DZD") {
      const fx = rates.DZD;
      investmentAed = fx > 0 ? amount / fx : manualRate > 0 ? amount / manualRate : amount;
    } else if (form.currency === "EUR" && rates.EUR > 0) {
      investmentAed = amount / rates.EUR;
    } else if (form.currency === "USD" && rates.USD > 0) {
      investmentAed = amount / rates.USD;
    }
    const baseTotalCapital = effectiveTotalCapital || 0;
    const newTotalCapital =
      editingId && investors.find((i) => i.id === editingId)
        ? // adjust total capital by removing old capital and adding new capital for this investor
          baseTotalCapital -
          (investors.find((i) => i.id === editingId)?.investment_aed ?? 0) +
          investmentAed
        : baseTotalCapital + investmentAed;
    const share = parseNum(form.profitSharePercent);
    if (share < 0 || share > 100) {
      setError("Profit share % must be between 0 and 100.");
      return;
    }
    const otherSharesTotal = investors
      .filter((i) => i.id !== editingId)
      .reduce((s, i) => s + (i.profit_share_percent ?? 0), 0);
    if (otherSharesTotal + share > 100) {
      setError("Total investor profit share cannot exceed 100%.");
      return;
    }
    setIsSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      investment_amount: amount,
      original_amount: amount,
      original_currency: form.currency,
      currency: form.currency,
      rate: form.currency === "DZD" ? manualRate : null,
      investment_aed: investmentAed,
      profit_share_percent: share,
      investment_date: form.investmentDate || null,
      notes: form.notes.trim() || null,
    };
    if (editingId) {
      const { error: updateErr } = await supabase.from("investors").update(payload).eq("id", editingId);
      if (updateErr) {
        setError(updateErr.message);
        setIsSaving(false);
        return;
      }
      setInvestors((prev) =>
        prev.map((i) => (i.id === editingId ? { ...i, ...payload } : i))
      );
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("investors")
        .insert(payload)
        .select("*")
        .single();
      if (insertErr) {
        setError(insertErr.message);
        setIsSaving(false);
        return;
      }
      setInvestors((prev) => [...prev, inserted as Investor].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    }
    setIsSaving(false);
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleDelete = async (i: Investor) => {
    if (!canDelete) return;
    if (!window.confirm(`Delete investor "${i.name}"? This cannot be undone.`)) return;
    setDeletingId(i.id);
    const { error: delErr } = await supabase.from("investors").delete().eq("id", i.id);
    if (delErr) {
      setError(delErr.message);
      setDeletingId(null);
      return;
    }
    setInvestors((prev) => prev.filter((x) => x.id !== i.id));
    setDeletingId(null);
  };

  const getInvestorProfitEarned = (investorId: string) => {
    const inv = investors.find((i) => i.id === investorId);
    if (!inv) return 0;
    const ratio = (inv.profit_share_percent ?? 0) / 100;
    return Object.values(profitByMonth).reduce(
      (s, totalProfit) => s + totalProfit * ratio,
      0
    );
  };
  const getInvestorWithdrawn = (investorId: string) =>
    returns
      .filter((r) => r.investor_id === investorId && (r.status || "").toLowerCase() === "paid")
      .reduce((s, r) => s + (r.investor_share ?? 0), 0);

  const openPayOutModal = (
    investorId: string,
    month: string,
    totalProfit: number,
    investorShare: number
  ) => {
    if (investorShare <= 0) return;
    setPayOutReturn({ investorId, month, totalProfit, investorShare });
    setPayOutPocket(AED_POCKETS[0]);
    setPayOutDate(new Date().toISOString().slice(0, 10));
  };

  const handleMarkReturnPaid = async () => {
    if (!payOutReturn) return;
    const { investorId, month, totalProfit, investorShare } = payOutReturn;
    if (investorShare <= 0) return;
    setIsSavingPayOut(true);
    setError(null);

    const key = `${investorId}-${month}`;
    const existing = returnByKey[key];
    if (existing) {
      const { error: updateErr } = await supabase
        .from("investor_returns")
        .update({ status: "paid", paid_date: payOutDate || new Date().toISOString().slice(0, 10) })
        .eq("id", existing.id);
      if (updateErr) {
        setError(updateErr.message);
        setIsSavingPayOut(false);
        return;
      }
    } else {
      const { error: insertErr } = await supabase.from("investor_returns").insert({
        investor_id: investorId,
        month,
        total_profit: totalProfit,
        investor_share: investorShare,
        status: "paid",
        paid_date: payOutDate || new Date().toISOString().slice(0, 10),
      });
      if (insertErr) {
        setError(insertErr.message);
        setIsSavingPayOut(false);
        return;
      }
    }

    const date = payOutDate || new Date().toISOString().slice(0, 10);

    const { error: movErr } = await supabase.from("movements").insert({
      date,
      type: "Out",
      category: "Investor Return",
      description: `Investor return payout - ${month}`,
      amount: investorShare,
      currency: "AED",
      pocket: payOutPocket,
    });
    if (movErr) {
      setError(movErr.message);
      setIsSavingPayOut(false);
      await fetchAll();
      return;
    }

    const { data: pocketRow } = await supabase
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", payOutPocket)
      .eq("currency", "AED")
      .limit(1)
      .maybeSingle();
    if (pocketRow && (pocketRow as { id: string }).id) {
      const current = (pocketRow as { amount: number }).amount || 0;
      await supabase
        .from("cash_positions")
        .update({ amount: current - investorShare })
        .eq("id", (pocketRow as { id: string }).id);
    }

    await fetchAll();
    setIsSavingPayOut(false);
    setPayOutReturn(null);
  };

  const handleReinvestReturn = async (
    investorId: string,
    month: string,
    totalProfit: number,
    investorShare: number
  ) => {
    if (investorShare <= 0) return;
    setMarkingPaid(`${investorId}-${month}`);
    setError(null);

    const key = `${investorId}-${month}`;
    const existing = returnByKey[key];
    if (existing) {
      const { error: updateErr } = await supabase
        .from("investor_returns")
        .update({ status: "paid", paid_date: new Date().toISOString().slice(0, 10) })
        .eq("id", existing.id);
      if (updateErr) {
        setError(updateErr.message);
        setMarkingPaid(null);
        return;
      }
    } else {
      const { error: insertErr } = await supabase.from("investor_returns").insert({
        investor_id: investorId,
        month,
        total_profit: totalProfit,
        investor_share: investorShare,
        status: "paid",
        paid_date: new Date().toISOString().slice(0, 10),
      });
      if (insertErr) {
        setError(insertErr.message);
        setMarkingPaid(null);
        return;
      }
    }

    const inv = investors.find((i) => i.id === investorId);
    const currentCapital = inv?.investment_aed ?? 0;
    const newCapital = currentCapital + investorShare;
    const { error: invErr } = await supabase
      .from("investors")
      .update({ investment_aed: newCapital })
      .eq("id", investorId);
    if (invErr) {
      setError(invErr.message);
      setMarkingPaid(null);
      return;
    }

    await fetchAll();
    setMarkingPaid(null);
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="border-b border-app surface px-4 py-4">
        <h1 className="text-xl font-semibold text-app">Investor Dashboard</h1>
        <p className="mt-1 text-xs text-muted">Manage investors and profit share returns.</p>
      </div>

      <div className="flex border-b border-app surface px-4">
        {(["Investors", "Returns", "Owner"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              activeTab === tab
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-transparent text-muted hover:text-app"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md border border-red-800 bg-red-950/30 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {activeTab === "Investors" && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3 items-end">
              <div className="rounded-lg border border-app surface p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Total Capital (AED equivalent)
                </div>
                <div className="mt-2 text-xl font-semibold text-app">
                  {formatMoney(effectiveTotalCapital, "AED")}
                </div>
              </div>
              <div className="space-y-1 text-xs text-app">
                <span className="font-semibold">Override total capital (optional)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={totalCapitalOverride}
                  onChange={(e) => setTotalCapitalOverride(e.target.value)}
                  placeholder={String(totalInvested || "")}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
                <p className="text-[10px] text-gray-400">
                  Leave empty to use sum of all investor capital.
                </p>
              </div>
              <div className="flex justify-end">
                {!isInvestorReadOnly ? (
                <button
                  type="button"
                  onClick={openAdd}
                  className="h-10 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a03020]"
                >
                  Add Investor
                </button>
                ) : null}
              </div>
            </div>
            {isLoading ? (
              <div className="rounded-lg border border-app surface p-6 text-center text-muted">
                Loading...
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-app surface">
                <table className="min-w-[700px] w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-app text-muted">
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Investment (AED eq)</th>
                      <th className="px-4 py-3 font-semibold hidden sm:table-cell">Profit share %</th>
                      <th className="px-4 py-3 font-semibold hidden sm:table-cell">Total profit earned</th>
                      <th className="px-4 py-3 font-semibold hidden sm:table-cell">Total withdrawn</th>
                      <th className="px-4 py-3 font-semibold">Balance</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {investors.map((i) => {
                      const earned = getInvestorProfitEarned(i.id);
                      const withdrawn = getInvestorWithdrawn(i.id);
                      const balance = earned - withdrawn;
                      const sharePct = i.profit_share_percent ?? 0;
                      return (
                        <tr key={i.id} className="border-b border-app last:border-0">
                          <td className="px-4 py-3 text-app">{i.name ?? "—"}</td>
                          <td className="px-4 py-3 text-app">
                            {i.original_amount != null && i.original_currency ? (
                              <>
                                {formatNumber(i.original_amount)} {i.original_currency}{" "}
                                <span className="text-[11px] text-gray-400">
                                  ({formatMoney(i.investment_aed, "AED")} at current rate)
                                </span>
                              </>
                            ) : (
                              formatMoney(i.investment_aed, "AED")
                            )}
                          </td>
                          <td className="px-4 py-3 text-app hidden sm:table-cell">{sharePct.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-app hidden sm:table-cell">{formatMoney(earned, "AED")}</td>
                          <td className="px-4 py-3 text-app hidden sm:table-cell">{formatMoney(withdrawn, "AED")}</td>
                          <td className="px-4 py-3 font-medium text-[var(--color-accent)]">{formatMoney(balance, "AED")}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {!isInvestorReadOnly ? (
                              <>
                              <button type="button" onClick={() => openEdit(i)} className="text-[var(--color-accent)] hover:underline">
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setBonusInvestorId(i.id);
                                  setBonusAmount("");
                                  setBonusReason("");
                                  setBonusDate(new Date().toISOString().slice(0, 10));
                                  setBonusPocket(AED_POCKETS[0]);
                                }}
                                className="text-amber-300 hover:underline"
                              >
                                Add Bonus
                              </button>
                              {canDelete ? (
                              <button
                                type="button"
                                onClick={() => handleDelete(i)}
                                disabled={deletingId === i.id}
                                className="text-red-400 hover:underline disabled:opacity-50"
                              >
                                {deletingId === i.id ? "Deleting..." : "Delete"}
                              </button>
                              ) : null}
                              </>
                              ) : (
                                <span className="text-[11px] text-muted">View only</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {investors.length === 0 && (
                  <div className="p-6 text-center text-gray-400">No investors yet. Add one to get started.</div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "Returns" && (
          <>
            <div className="mb-4 rounded-lg border border-app surface p-4">
              <h3 className="text-sm font-semibold text-app">Running total</h3>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-gray-400">Total invested</span>
                  <p className="font-semibold text-app">{formatMoney(totalInvested, "AED")}</p>
                </div>
                <div>
                  <span className="text-gray-400">Total returned</span>
                  <p className="font-semibold text-app">{formatMoney(totalReturned, "AED")}</p>
                </div>
                <div>
                  <span className="text-gray-400">ROI %</span>
                  <p className="font-semibold text-[var(--color-accent)]">{roiPercent.toFixed(1)}%</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-app surface">
              <table className="min-w-[680px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-app text-muted">
                    <th className="px-4 py-3 font-semibold">Month</th>
                    <th className="px-4 py-3 font-semibold hidden sm:table-cell">Total profit</th>
                    <th className="px-4 py-3 font-semibold">Investor</th>
                    <th className="px-4 py-3 font-semibold">Share</th>
                    <th className="px-4 py-3 font-semibold hidden sm:table-cell">Status</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {monthsSorted.flatMap((month) => {
                    const totalProfit = profitByMonth[month] ?? 0;
                    return investors.map((inv) => {
                      const ratio = (inv.profit_share_percent ?? 0) / 100;
                      const share = totalProfit * ratio;
                      const key = `${inv.id}-${month}`;
                      const ret = returnByKey[key];
                      const status = ret ? (ret.status || "pending") : "pending";
                      const isPaid = status.toLowerCase() === "paid";
                      return (
                        <tr key={key} className="border-b border-app last:border-0">
                          <td className="px-4 py-3 text-app">{month}</td>
                          <td className="px-4 py-3 text-app hidden sm:table-cell">{formatMoney(totalProfit, "AED")}</td>
                          <td className="px-4 py-3 text-app">{inv.name ?? "—"}</td>
                          <td className="px-4 py-3 font-semibold text-[var(--color-accent)]">{formatMoney(share, "AED")}</td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className={isPaid ? "text-emerald-400" : "text-amber-400"}>{status}</span>
                          </td>
                          <td className="px-4 py-3">
                            {!isPaid && share > 0 && (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleReinvestReturn(inv.id, month, totalProfit, share)}
                                  disabled={markingPaid === key}
                                  className="rounded bg-zinc-700 px-2 py-1 text-xs font-medium text-app disabled:opacity-50"
                                >
                                  {markingPaid === key ? "..." : "Reinvest"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openPayOutModal(inv.id, month, totalProfit, share)}
                                  className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-white"
                                >
                                  Pay Out
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
              {monthsSorted.length === 0 && (
                <div className="p-6 text-center text-gray-400">No deal profit by month. Deals will appear here.</div>
              )}
            </div>
          </>
        )}
        {activeTab === "Owner" && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-app surface p-4 text-sm space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Owner
                </div>
                <label className="space-y-1 text-xs text-app">
                  <span className="font-semibold">Name</span>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  />
                </label>
                <label className="space-y-1 text-xs text-app">
                  <span className="font-semibold">My Capital</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={ownerCapital}
                      onChange={(e) => setOwnerCapital(e.target.value)}
                      className="flex-1 rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                    <select
                      value={ownerCapitalCurrency}
                      onChange={(e) =>
                        setOwnerCapitalCurrency(e.target.value as "AED" | "DZD" | "EUR" | "USD")
                      }
                      className="w-20 rounded-md border border-app bg-white px-2 py-2 text-sm text-app"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
                <div className="text-[11px] text-gray-400">
                  AED equivalent:{" "}
                  {(() => {
                    const amt = parseNum(ownerCapital);
                    let aed = amt;
                    if (ownerCapitalCurrency === "DZD" && rates.DZD > 0) aed = amt / rates.DZD;
                    else if (ownerCapitalCurrency === "EUR" && rates.EUR > 0) aed = amt / rates.EUR;
                    else if (ownerCapitalCurrency === "USD" && rates.USD > 0) aed = amt / rates.USD;
                    return formatMoney(aed, "AED");
                  })()}{" "}
                  <span className="text-[10px]">
                    (at current rate)
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-app surface p-4 text-sm space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Business
                </div>
                <label className="space-y-1 text-xs text-app">
                  <span className="font-semibold">Business Valuation (AED)</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={businessValuation}
                    onChange={(e) => setBusinessValuation(e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  />
                </label>
                <label className="space-y-1 text-xs text-app">
                  <span className="font-semibold">Share price (AED)</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={sharePrice}
                    onChange={(e) => setSharePrice(e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">Total shares</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={totalShares}
                      onChange={(e) => setTotalShares(e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-app">
                    <span className="font-semibold">Available shares</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={availableShares}
                      onChange={(e) => setAvailableShares(e.target.value)}
                      className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                    />
                  </label>
                </div>
              </div>
              <div className="rounded-lg border border-app surface p-4 text-sm space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Notes
                </div>
                <textarea
                  value={ownerNotes}
                  onChange={(e) => setOwnerNotes(e.target.value)}
                  rows={8}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isSavingOwner}
                    onClick={async () => {
                      setIsSavingOwner(true);
                      setError(null);
                      const updates = [
                        { key: "owner_name", value: ownerName || null },
                        { key: "owner_capital", value: ownerCapital || null },
                        { key: "owner_capital_currency", value: ownerCapitalCurrency },
                        { key: "business_valuation", value: businessValuation || null },
                        { key: "share_price", value: sharePrice || null },
                        { key: "total_shares", value: totalShares || null },
                        { key: "available_shares", value: availableShares || null },
                        { key: "owner_notes", value: ownerNotes || null },
                      ];
                      const { error: saveErr } = await supabase
                        .from("app_settings")
                        .upsert(updates, { onConflict: "key" });
                      if (saveErr) {
                        setError(saveErr.message);
                      }
                      setIsSavingOwner(false);
                    }}
                    className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {isSavingOwner ? "Saving..." : "Save Owner Settings"}
                  </button>
                </div>
              </div>
            </div>
            {(() => {
              const ownerAmt = parseNum(ownerCapital);
              let ownerAed = ownerAmt;
              if (ownerCapitalCurrency === "DZD" && rates.DZD > 0) ownerAed = ownerAmt / rates.DZD;
              else if (ownerCapitalCurrency === "EUR" && rates.EUR > 0) ownerAed = ownerAmt / rates.EUR;
              else if (ownerCapitalCurrency === "USD" && rates.USD > 0) ownerAed = ownerAmt / rates.USD;
              const valuation = parseNum(businessValuation);
              const myPct = valuation > 0 ? (ownerAed / valuation) * 100 : 0;
              const investorCapitalAed = investors.reduce(
                (s, i) => s + (i.investment_aed ?? 0),
                0
              );
              const investorPct = valuation > 0 ? (investorCapitalAed / valuation) * 100 : 0;
              const availablePct = Math.max(0, 100 - myPct - investorPct);
              return (
                <div className="rounded-lg border border-app surface p-4 text-sm space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Ownership Summary
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="text-gray-400 text-xs">My equity (AED)</div>
                      <div className="text-lg font-semibold text-app">
                        {formatMoney(ownerAed, "AED")}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs">Business worth</div>
                      <div className="text-lg font-semibold text-app">
                        {formatMoney(valuation, "AED")}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs">My ownership %</div>
                      <div className="text-lg font-semibold text-app">
                        {myPct.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs">Investor ownership %</div>
                      <div className="text-lg font-semibold text-app">
                        {investorPct.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs">Available for new investors %</div>
                      <div className="text-lg font-semibold text-[var(--color-accent)]">
                        {availablePct.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* Add/Edit Investor Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-app">{editingId ? "Edit Investor" : "Add Investor"}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Full name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Investment amount</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.investmentAmount}
                  onChange={(e) => updateField("investmentAmount", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Currency</span>
                <select
                  value={form.currency}
                  onChange={(e) => updateField("currency", e.target.value as (typeof CURRENCIES)[number])}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              {form.currency === "DZD" && (
                <label className="space-y-1 text-xs text-app sm:col-span-2">
                  <span className="font-semibold">Rate (DZD per AED, to convert to AED)</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.rate}
                    onChange={(e) => updateField("rate", e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  />
                </label>
              )}
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Investment date</span>
                <input
                  type="date"
                  value={form.investmentDate}
                  onChange={(e) => updateField("investmentDate", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Profit share %</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.profitSharePercent}
                  onChange={(e) => updateField("profitSharePercent", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              {form.investmentAmount && (
                <p className="sm:col-span-2 text-xs text-gray-400">
                  AED equivalent: {formatMoney(investmentAedFromForm, "AED")}
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-app px-4 py-2 text-sm font-medium text-app disabled:opacity-50"
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
      )}

      {/* Pay Out Return Modal */}
      {payOutReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              if (!isSavingPayOut) setPayOutReturn(null);
            }}
          />
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-app">Pay out investor return</h2>
            <p className="mt-1 text-xs text-muted">
              This will create a movement Out with category <span className="font-semibold">Investor Return</span> and mark this return as paid.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs text-app">
              <div>
                <span className="text-gray-400">Investor</span>
                <div className="mt-1 text-app">
                  {investors.find((i) => i.id === payOutReturn.investorId)?.name ?? "—"}
                </div>
              </div>
              <div>
                <span className="text-gray-400">Month</span>
                <div className="mt-1 text-app">{payOutReturn.month}</div>
              </div>
              <div>
                <span className="text-gray-400">Amount</span>
                <div className="mt-1 text-[var(--color-accent)] font-semibold">
                  {formatMoney(payOutReturn.investorShare, "AED")}
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-gray-400">Date</span>
                <input
                  type="date"
                  value={payOutDate}
                  onChange={(e) => setPayOutDate(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                />
              </label>
              <label className="space-y-1">
                <span className="text-gray-400">Pocket</span>
                <select
                  value={payOutPocket}
                  onChange={(e) => setPayOutPocket(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                >
                  {AED_POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!isSavingPayOut) setPayOutReturn(null);
                }}
                disabled={isSavingPayOut}
                className="rounded-md border border-app px-4 py-2 text-sm font-medium text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMarkReturnPaid}
                disabled={isSavingPayOut}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSavingPayOut ? "Paying..." : "Confirm payout"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Bonus Modal */}
      {bonusInvestorId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              if (!isSavingBonus) {
                setBonusInvestorId(null);
                setBonusAmount("");
                setBonusReason("");
              }
            }}
          />
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-app">Add bonus</h2>
            <p className="mt-1 text-xs text-muted">
              Record an extra payout for this investor. This will count as withdrawn and create a movement.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Amount (AED)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Date</span>
                <input
                  type="date"
                  value={bonusDate}
                  onChange={(e) => setBonusDate(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Pay from pocket</span>
                <select
                  value={bonusPocket}
                  onChange={(e) => setBonusPocket(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                >
                  {AED_POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Reason (optional)</span>
                <input
                  type="text"
                  value={bonusReason}
                  onChange={(e) => setBonusReason(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!isSavingBonus) {
                    setBonusInvestorId(null);
                    setBonusAmount("");
                    setBonusReason("");
                  }
                }}
                className="rounded-md border border-app px-4 py-2 text-sm font-medium text-app disabled:opacity-50"
                disabled={isSavingBonus}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingBonus}
                onClick={async () => {
                  if (!bonusInvestorId) return;
                  const amount = parseNum(bonusAmount);
                  if (amount <= 0) {
                    setError("Bonus amount must be greater than 0.");
                    return;
                  }
                  const date = bonusDate || new Date().toISOString().slice(0, 10);
                  const month = date.slice(0, 7);
                  setIsSavingBonus(true);
                  setError(null);

                  const { error: retErr } = await supabase.from("investor_returns").insert({
                    investor_id: bonusInvestorId,
                    month,
                    total_profit: 0,
                    investor_share: amount,
                    status: "paid",
                    paid_date: date,
                  });
                  if (retErr) {
                    setError(retErr.message);
                    setIsSavingBonus(false);
                    return;
                  }

                  const { error: movErr } = await supabase.from("movements").insert({
                    date,
                    type: "Out",
                    category: "Other",
                    description: bonusReason || `Investor bonus - ${month}`,
                    amount,
                    currency: "AED",
                    pocket: bonusPocket,
                  });
                  if (movErr) {
                    setError(movErr.message);
                    setIsSavingBonus(false);
                    await fetchAll();
                    return;
                  }

                  const { data: pocketRow } = await supabase
                    .from("cash_positions")
                    .select("id, amount")
                    .eq("pocket", bonusPocket)
                    .eq("currency", "AED")
                    .limit(1)
                    .maybeSingle();
                  if (pocketRow && (pocketRow as { id: string }).id) {
                    const current = (pocketRow as { amount: number }).amount || 0;
                    await supabase
                      .from("cash_positions")
                      .update({ amount: current - amount })
                      .eq("id", (pocketRow as { id: string }).id);
                  }

                  await fetchAll();
                  setIsSavingBonus(false);
                  setBonusInvestorId(null);
                  setBonusAmount("");
                  setBonusReason("");
                }}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSavingBonus ? "Saving..." : "Save bonus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
