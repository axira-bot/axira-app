"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ActivityEntity } from "@/lib/activity";

type ActivityLogRow = {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  description: string;
  amount: number | null;
  currency: string | null;
  created_at: string;
};

const ENTITY_OPTIONS: { value: ActivityEntity | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "deal", label: "Deal" },
  { value: "car", label: "Car" },
  { value: "movement", label: "Movement" },
  { value: "container", label: "Container" },
  { value: "client", label: "Client" },
  { value: "conversion", label: "Conversion" },
  { value: "rent", label: "Rent" },
  { value: "salary", label: "Salary" },
  { value: "payment", label: "Payment" },
  { value: "employee", label: "Employee" },
  { value: "debt", label: "Debt" },
];

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number, currency: string): string {
  return `${formatNumber(value)} ${currency}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(iso);
}

function displayType(entity: string): string {
  if (!entity) return "—";
  return entity.charAt(0).toUpperCase() + entity.slice(1);
}

export default function ActivityPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [entityFilter, setEntityFilter] = useState<ActivityEntity | "">("");

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    let query = supabase
      .from("activity_log")
      .select("id, action, entity, entity_id, description, amount, currency, created_at")
      .order("created_at", { ascending: false });

    if (dateFrom) {
      query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    }
    if (dateTo) {
      query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    }
    if (entityFilter) {
      query = query.eq("entity", entityFilter);
    }

    const { data, error: fetchErr } = await query;

    if (fetchErr) {
      setError(fetchErr.message);
      setRows([]);
    } else {
      setRows((data as ActivityLogRow[]) ?? []);
    }
    setIsLoading(false);
  }, [dateFrom, dateTo, entityFilter]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Activity Log
          </h1>
          <p className="text-sm font-medium text-[var(--color-accent)]">
            System activity in chronological order
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex flex-col gap-1 text-xs text-muted">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Type
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value as ActivityEntity | "")}
              className="rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            >
              {ENTITY_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-lg border border-app surface overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-sm text-muted">Loading activity...</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted">No activity in this range.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-b border-app last:border-b-0">
                      <td className="px-4 py-3 text-app whitespace-nowrap">
                        {formatDate(a.created_at)}
                        <span className="ml-2 text-gray-400">({timeAgo(a.created_at)})</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-app">
                          {a.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-app">
                          {displayType(a.entity)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-app">{a.description}</td>
                      <td className="px-4 py-3 text-right text-app">
                        {a.amount != null && a.currency
                          ? formatMoney(a.amount, a.currency)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
