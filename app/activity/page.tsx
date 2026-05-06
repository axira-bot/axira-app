"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Card, Chip, Input, Label, Spinner, TextField } from "@heroui/react";
import { supabase } from "@/lib/supabase";
import type { ActivityEntity } from "@/lib/activity";
import { PaginatedTable } from "@/components/ui/paginated-table";
import { PageContainer } from "@/components/ui/page-container";
import { ResponsiveFilterBar } from "@/components/ui/responsive-filter-bar";

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
      <PageContainer size="md">
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
          <Card.Content className="pb-6">
            <ResponsiveFilterBar>
            <TextField name="dateFrom" type="date" value={dateFrom} onChange={setDateFrom} className="w-full md:col-span-3">
              <Label className="text-xs text-default-500">From</Label>
              <Input className="text-sm" />
            </TextField>
            <TextField name="dateTo" type="date" value={dateTo} onChange={setDateTo} className="w-full md:col-span-3">
              <Label className="text-xs text-default-500">To</Label>
              <Input className="text-sm" />
            </TextField>
            <div className="flex w-full flex-col gap-1 md:col-span-4">
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
            </ResponsiveFilterBar>
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
              <div className="responsive-table-wrap">
                <PaginatedTable
                  rows={rows}
                  rowKey={(row) => row.id}
                  pageSize={12}
                  emptyContent="No activity in this range."
                  columns={[
                    {
                      key: "time",
                      label: "Time",
                      render: (row) => (
                        <span className="whitespace-nowrap">
                          {formatDate(row.created_at)}
                          <span className="ml-2 text-default-400">({timeAgo(row.created_at)})</span>
                        </span>
                      ),
                    },
                    {
                      key: "action",
                      label: "Action",
                      render: (row) => (
                        <Chip size="sm" variant="soft">
                          {row.action}
                        </Chip>
                      ),
                    },
                    {
                      key: "type",
                      label: "Type",
                      render: (row) => (
                        <Chip size="sm" variant="secondary">
                          {displayType(row.entity)}
                        </Chip>
                      ),
                    },
                    { key: "user", label: "User", render: (row) => row.actor_name || row.actor_user_id || "System" },
                    { key: "description", label: "Description", render: (row) => row.description },
                    {
                      key: "amount",
                      label: "Amount",
                      align: "end",
                      render: (row) => (row.amount != null && row.currency ? formatMoney(row.amount, row.currency) : "—"),
                    },
                  ]}
                />
              </div>
            )}
          </Card.Content>
        </Card.Root>
      </PageContainer>
    </div>
  );
}
