"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Card, Chip, Input, Label, Spinner, TextField } from "@heroui/react";
import { supabase } from "@/lib/supabase";
import type { ActivityEntity } from "@/lib/activity";
import { PaginatedTable } from "@/components/ui/paginated-table";
import { PageContainer } from "@/components/ui/page-container";
import { ResponsiveFilterBar } from "@/components/ui/responsive-filter-bar";
import {
  formatDateForLocale,
  formatNumberForLocale,
  useI18n,
} from "@/lib/context/I18nContext";
import { activityEntityLabel } from "@/lib/i18n/enumLabels";

type AuditLogRow = {
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

const ENTITY_VALUES: (ActivityEntity | "")[] = [
  "",
  "deal",
  "car",
  "movement",
  "container",
  "client",
  "conversion",
  "rent",
  "salary",
  "payment",
  "employee",
  "debt",
];

export default function AuditPage() {
  const { t, locale } = useI18n();

  const formatNumber = (value: number) =>
    formatNumberForLocale(locale, value, { maximumFractionDigits: 0 });

  const formatMoney = (value: number, currency: string) =>
    `${formatNumber(value)} ${currency}`;

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    if (Number.isNaN(new Date(value).getTime())) return "—";
    return formatDateForLocale(locale, value, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
    return formatDate(iso);
  };

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [entityFilter, setEntityFilter] = useState<ActivityEntity | "">("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorQuery, setActorQuery] = useState("");

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
    if (actionFilter.trim()) {
      query = query.eq("action", actionFilter.trim().toLowerCase());
    }

    const { data, error: fetchErr } = await query;

    if (fetchErr) {
      setError(fetchErr.message);
      setRows([]);
      setIsLoading(false);
      return;
    }

    let list = (data as AuditLogRow[]) ?? [];
    const q = actorQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          (r.actor_name && r.actor_name.toLowerCase().includes(q)) ||
          (r.actor_user_id && r.actor_user_id.toLowerCase().includes(q))
      );
    }
    setRows(list);
    setIsLoading(false);
  }, [dateFrom, dateTo, entityFilter, actionFilter, actorQuery]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="min-h-full w-full min-w-0 text-foreground" style={{ background: "var(--color-bg)" }}>
      <PageContainer size="lg">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("activityLog.auditTitle")}</h1>
          <p className="text-sm font-medium text-danger">{t("activityLog.auditSubtitle")}</p>
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
              <Label className="text-xs text-default-500">{t("activityLog.from")}</Label>
              <Input className="text-sm" />
            </TextField>
            <TextField name="dateTo" type="date" value={dateTo} onChange={setDateTo} className="w-full md:col-span-3">
              <Label className="text-xs text-default-500">{t("activityLog.to")}</Label>
              <Input className="text-sm" />
            </TextField>
            <div className="flex w-full flex-col gap-1 md:col-span-3">
              <Label className="text-xs text-default-500">{t("activityLog.entity")}</Label>
              <select
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value as ActivityEntity | "")}
                className="rounded-lg border border-default-200 bg-content1 px-3 py-2 text-sm outline-none focus:border-danger"
              >
                {ENTITY_VALUES.map((value) => (
                  <option key={value || "all"} value={value}>
                    {value === "" ? t("activityLog.entities.all") : activityEntityLabel(t, value)}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              name="action"
              value={actionFilter}
              onChange={setActionFilter}
              className="w-full md:col-span-1"
            >
              <Label className="text-xs text-default-500">{t("activityLog.action")}</Label>
              <Input className="text-sm" placeholder={t("activityLog.actionPlaceholder")} />
            </TextField>
            <TextField name="actor" value={actorQuery} onChange={setActorQuery} className="w-full md:col-span-2">
              <Label className="text-xs text-default-500">{t("activityLog.actor")}</Label>
              <Input className="text-sm" placeholder={t("activityLog.actorPlaceholder")} type="search" />
            </TextField>
            </ResponsiveFilterBar>
          </Card.Content>
        </Card.Root>

        <Card.Root className="border border-default-200 shadow-sm overflow-hidden">
          <Card.Content className="p-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <Spinner size="md" color="danger" />
                <span className="text-sm text-default-500">{t("activityLog.loadingAudit")}</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm text-default-500">{t("activityLog.emptyAudit")}</div>
            ) : (
              <div className="responsive-table-wrap">
                <PaginatedTable
                  rows={rows}
                  rowKey={(row) => row.id}
                  pageSize={12}
                  emptyContent={t("activityLog.emptyAudit")}
                  columns={[
                    {
                      key: "time",
                      label: t("activityLog.time"),
                      render: (row) => (
                        <span className="whitespace-nowrap">
                          {formatDate(row.created_at)}
                          <span className="ml-2 text-default-400">({timeAgo(row.created_at)})</span>
                        </span>
                      ),
                    },
                    {
                      key: "actor",
                      label: t("activityLog.actor"),
                      render: (row) => (
                        <div>
                          <div className="font-medium">{row.actor_name || "—"}</div>
                          {row.actor_user_id ? <div className="break-all text-[10px] text-default-500">{row.actor_user_id}</div> : null}
                        </div>
                      ),
                    },
                    {
                      key: "action",
                      label: t("activityLog.action"),
                      render: (row) => (
                        <Chip size="sm" variant="soft">
                          {row.action}
                        </Chip>
                      ),
                    },
                    {
                      key: "entity",
                      label: t("activityLog.entity"),
                      render: (row) => (
                        <Chip size="sm" variant="secondary">
                          {activityEntityLabel(t, row.entity)}
                        </Chip>
                      ),
                    },
                    {
                      key: "recordId",
                      label: t("activityLog.recordId"),
                      render: (row) => <span className="font-mono text-[10px]">{row.entity_id || "—"}</span>,
                    },
                    {
                      key: "description",
                      label: t("activityLog.description"),
                      render: (row) => <span className="max-w-md">{row.description}</span>,
                    },
                    {
                      key: "amount",
                      label: t("activityLog.amount"),
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
