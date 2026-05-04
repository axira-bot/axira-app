"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Card, Chip, Input, Label, Spinner, TextField } from "@heroui/react";
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
  actor_user_id: string | null;
  actor_name: string | null;
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
      .select("id, action, entity, entity_id, description, amount, currency, actor_user_id, actor_name, created_at")
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
    <div className="min-h-full text-foreground" style={{ background: "var(--color-bg)" }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Activity Log</h1>
          <p className="text-sm font-medium text-danger">System activity in chronological order</p>
        </header>

        {error ? (
          <Alert.Root status="danger">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <Card.Root className="border border-default-200 shadow-sm">
          <Card.Content className="flex flex-wrap items-end gap-4 pb-6">
            <TextField name="dateFrom" type="date" value={dateFrom} onChange={setDateFrom} className="min-w-[160px]">
              <Label className="text-xs text-default-500">From</Label>
              <Input className="text-sm" />
            </TextField>
            <TextField name="dateTo" type="date" value={dateTo} onChange={setDateTo} className="min-w-[160px]">
              <Label className="text-xs text-default-500">To</Label>
              <Input className="text-sm" />
            </TextField>
            <div className="flex min-w-[180px] flex-col gap-1">
              <Label className="text-xs text-default-500">Type</Label>
              <select
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value as ActivityEntity | "")}
                className="rounded-lg border border-default-200 bg-content1 px-3 py-2 text-sm outline-none focus:border-danger"
              >
                {ENTITY_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root className="border border-default-200 shadow-sm overflow-hidden">
          <Card.Content className="p-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <Spinner size="md" color="danger" />
                <span className="text-sm text-default-500">Loading activity…</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm text-default-500">No activity in this range.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-default-200 bg-default-50 text-[11px] uppercase tracking-wide text-default-500">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id} className="border-b border-default-100 last:border-b-0 hover:bg-default-50/80">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {formatDate(a.created_at)}
                          <span className="ml-2 text-default-400">({timeAgo(a.created_at)})</span>
                        </td>
                        <td className="px-4 py-3">
                          <Chip size="sm" variant="soft">
                            {a.action}
                          </Chip>
                        </td>
                        <td className="px-4 py-3">
                          <Chip size="sm" variant="secondary">
                            {displayType(a.entity)}
                          </Chip>
                        </td>
                        <td className="px-4 py-3">
                          {a.actor_name || a.actor_user_id || "System"}
                        </td>
                        <td className="px-4 py-3">{a.description}</td>
                        <td className="px-4 py-3 text-right">
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
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  );
}
