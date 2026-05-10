"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Spinner } from "@heroui/react";
import { useAuth } from "@/lib/context/AuthContext";
import { hasFeature } from "@/lib/auth/permissions";
import type { FeatureKey, FeaturePermissions } from "@/lib/auth/featureKeys";
import { getRates, type AppRates } from "@/lib/rates";
import { displayFxFromAppRates } from "@/lib/finance/dealMoney";
import { SalesNotesField, type SalesNotesSaveResult } from "@/components/cars/SalesNotesField";
import { formatDateForLocale, formatNumberForLocale, useI18n } from "@/lib/context/I18nContext";

type CarRow = Record<string, unknown>;
type CatalogRow = Record<string, unknown>;

type CarDetailResponse = {
  car: CarRow;
  purchase_order: Record<string, unknown> | null;
  container: Record<string, unknown> | null;
  linked_deals: Record<string, unknown>[];
  status_timeline: Array<{ field_name: string; old_value: string | null; new_value: string; changed_at: string }>;
  sales_notes_updated_by_name: string | null;
};

function vinLast6(vin: unknown): string | null {
  const s = String(vin || "").trim();
  if (s.length < 6) return null;
  return s.slice(-6);
}

function firstPhotoUrl(row: CarRow | CatalogRow): string | null {
  const raw = row.photos;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  return typeof first === "string" && first.trim() ? first : null;
}

export default function SalesListPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { permissions, loading: authLoading, isStaff, isManager, isOwnerLike } = useAuth();
  const canAccess = hasFeature(permissions as FeaturePermissions, "sales_list" as FeatureKey);
  const canSeeInternal = isManager || isOwnerLike;
  const canEditSalesNotes = isManager || isOwnerLike;

  const [tab, setTab] = useState<"now" | "soon" | "demand">("now");
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState("price_asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableNow, setAvailableNow] = useState<CarRow[]>([]);
  const [comingSoon, setComingSoon] = useState<CarRow[]>([]);
  const [orderOnDemand, setOrderOnDemand] = useState<CatalogRow[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [rates, setRates] = useState<AppRates>({ DZD: 0, EUR: 0, USD: 0, GBP: 0 });
  const [expand, setExpand] = useState<{ kind: "car" | "catalog"; row: CarRow | CatalogRow } | null>(null);
  const [carDetail, setCarDetail] = useState<CarDetailResponse | null>(null);
  const [carDetailLoading, setCarDetailLoading] = useState(false);
  const [carDetailError, setCarDetailError] = useState<string | null>(null);

  const moneyDzd = (n: number) =>
    `${formatNumberForLocale(locale, Number(n || 0), { maximumFractionDigits: 0 })} DZD`;

  const load = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (brand) params.set("brand", brand);
    if (minPrice.trim()) params.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) params.set("maxPrice", maxPrice.trim());
    if (sort) params.set("sort", sort);
    const res = await fetch(`/api/sales-list?${params.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error || t("salesList.loadFailed"));
      return;
    }
    setAvailableNow((data.availableNow as CarRow[]) || []);
    setComingSoon((data.comingSoon as CarRow[]) || []);
    setOrderOnDemand((data.orderOnDemand as CatalogRow[]) || []);
    setBrands((data.brands as string[]) || []);
  }, [canAccess, search, brand, minPrice, maxPrice, sort, t]);

  useEffect(() => {
    void getRates().then(setRates);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!canAccess) return;
    void load();
  }, [authLoading, canAccess, load]);

  useEffect(() => {
    if (!expand || expand.kind !== "car") {
      setCarDetail(null);
      setCarDetailError(null);
      setCarDetailLoading(false);
      return;
    }
    const id = String((expand.row as CarRow).id || "");
    if (!id) return;
    let cancelled = false;
    setCarDetailLoading(true);
    setCarDetailError(null);
    void fetch(`/api/sales-list/cars/${encodeURIComponent(id)}/detail`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as CarDetailResponse & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setCarDetailError(data.error || t("salesList.loadDetailFailed"));
          setCarDetail(null);
          return;
        }
        setCarDetail(data);
      })
      .catch(() => {
        if (!cancelled) {
          setCarDetailError(t("salesList.loadDetailFailed"));
          setCarDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCarDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expand, t]);

  const fx = useMemo(() => displayFxFromAppRates(rates), [rates]);

  const dzdRefs = useCallback(
    (dzd: number) => {
      const aed = fx.aedPerDzd > 0 ? dzd * fx.aedPerDzd : 0;
      const usd = fx.aedPerUsd > 0 ? aed / fx.aedPerUsd : 0;
      return { aed, usd };
    },
    [fx]
  );

  const rowsForTab = useMemo(() => {
    if (tab === "now") return availableNow;
    if (tab === "soon") return comingSoon;
    return orderOnDemand;
  }, [tab, availableNow, comingSoon, orderOnDemand]);

  const badgeForCar = (row: CarRow) => {
    const life = String(row.inventory_lifecycle_status || "").toUpperCase();
    if (life === "IN_STOCK") return t("salesList.lifecycleInStock");
    if (life === "AT_PORT") return t("salesList.lifecycleAtPort");
    if (life === "IN_TRANSIT") return t("salesList.lifecycleInTransit");
    if (life === "INCOMING") return t("salesList.lifecycleIncoming");
    return life || t("common.emiDash");
  };

  const primaryAction = (kind: "car" | "catalog", row: CarRow | CatalogRow) => {
    if (kind === "car") {
      const life = String((row as CarRow).inventory_lifecycle_status || "").toUpperCase();
      const id = String((row as CarRow).id || "");
      if (life === "IN_STOCK") {
        router.push(`/deals?addDeal=1&carId=${encodeURIComponent(id)}`);
        return;
      }
      router.push(`/deals?preorder=1&inventoryCarId=${encodeURIComponent(id)}`);
      return;
    }
    router.push(`/deals?preorder=1&salesCatalogId=${encodeURIComponent(String((row as CatalogRow).id || ""))}`);
  };

  const primaryLabel = (kind: "car" | "catalog", row: CarRow | CatalogRow) => {
    if (kind === "car") {
      const life = String((row as CarRow).inventory_lifecycle_status || "").toUpperCase();
      return life === "IN_STOCK" ? t("salesList.createDeal") : t("salesList.createPreorder");
    }
    return t("salesList.createPreorder");
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8">
        <Spinner color="danger" />
        <span className="text-sm text-default-500">{t("common.loadingEllipsis")}</span>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <main className="p-6">
        <Alert.Root status="warning">
          <Alert.Content>
            <Alert.Title>{t("salesList.noAccess")}</Alert.Title>
            <Alert.Description>{t("salesList.noAccessDesc")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </main>
    );
  }

  return (
    <main className="min-h-full space-y-5 p-6 text-foreground" style={{ background: "var(--color-bg)" }}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{t("salesList.pageTitle")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-default-500">
            {t("salesList.pageBlurb")}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-app bg-panel p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-6">
          <label className="text-xs md:col-span-2">
            <span className="text-default-500">{t("salesList.search")}</span>
            <input
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("salesList.searchPlaceholder")}
            />
          </label>
          <label className="text-xs">
            <span className="text-default-500">{t("salesList.brand")}</span>
            <select
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            >
              <option value="">{t("salesList.all")}</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-default-500">{t("salesList.minDzd")}</span>
            <input
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              type="number"
              min={0}
            />
          </label>
          <label className="text-xs">
            <span className="text-default-500">{t("salesList.maxDzd")}</span>
            <input
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              type="number"
              min={0}
            />
          </label>
          <label className="text-xs">
            <span className="text-default-500">{t("salesList.sort")}</span>
            <select className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="price_asc">{t("salesList.sortPriceAsc")}</option>
              <option value="price_desc">{t("salesList.sortPriceDesc")}</option>
              <option value="lead_asc">{t("salesList.sortLeadAsc")}</option>
            </select>
          </label>
        </div>
        <Button type="button" variant="primary" size="sm" onPress={() => void load()} isDisabled={loading}>
          {t("salesList.applyFilters")}
        </Button>
      </section>

      {error ? (
        <Alert.Root status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-lg border border-app bg-panel p-1">
        {(
          [
            ["now", t("salesList.tabAvailableNow", { count: availableNow.length })],
            ["soon", t("salesList.tabComingSoon", { count: comingSoon.length })],
            ["demand", t("salesList.tabOrderOnDemand", { count: orderOnDemand.length })],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={tab === key ? "primary" : "ghost"}
            className="min-w-0 flex-1 sm:flex-none"
            onPress={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner color="danger" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rowsForTab.length === 0 ? (
            <p className="text-sm text-default-500">{t("salesList.noVehicles")}</p>
          ) : (
            rowsForTab.map((row) => {
              const isCatalog = tab === "demand";
              const kind = isCatalog ? "catalog" : "car";
              const photo = firstPhotoUrl(row);
              const price = Number((row as { sale_price_dzd?: unknown }).sale_price_dzd ?? 0);
              const lead = isCatalog
                ? Number((row as CatalogRow).lead_time_days ?? 0)
                : Number((row as CarRow).sales_lead_time_days ?? 0);
              const dep = isCatalog
                ? Number((row as CatalogRow).deposit_amount_dzd ?? 0)
                : Number((row as CarRow).sales_deposit_dzd ?? 0);
              const title = `${(row as { brand?: unknown }).brand ?? ""} ${(row as { model?: unknown }).model ?? ""} ${(row as { year?: unknown }).year ?? ""}`.trim();
              const color = String((row as { color?: unknown }).color ?? "");
              const trim = String((row as { trim?: unknown }).trim ?? "");
              return (
                <div
                  key={String((row as { id?: unknown }).id)}
                  className="flex flex-col overflow-hidden rounded-xl border border-app bg-panel shadow-sm"
                >
                  <button type="button" className="relative h-40 w-full bg-black/5 text-left" onClick={() => setExpand({ kind, row })}>
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-default-400">{t("salesList.noPhoto")}</div>
                    )}
                  </button>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-default-600">
                        {isCatalog ? t("salesList.badgeCatalog") : badgeForCar(row as CarRow)}
                      </span>
                      {!isCatalog && vinLast6((row as CarRow).vin) ? (
                        <span className="text-[10px] text-default-500">
                          {t("salesList.vinTail", { tail: vinLast6((row as CarRow).vin) ?? "" })}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="text-sm font-semibold leading-snug">{title}</h3>
                    <p className="text-[11px] text-default-500">
                      {[color, trim].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-lg font-bold text-app">{moneyDzd(price)}</p>
                    <p className="text-xs text-default-600">
                      {t("salesList.leadDepositLine", {
                        lead: lead > 0 ? t("salesList.leadDays", { n: lead }) : t("common.emiDash"),
                        deposit: dep > 0 ? moneyDzd(dep) : t("common.emiDash"),
                      })}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      <Button type="button" size="sm" variant="outline" onPress={() => setExpand({ kind, row })}>
                        {t("salesList.details")}
                      </Button>
                      <Button type="button" size="sm" variant="primary" onPress={() => primaryAction(kind, row)}>
                        {primaryLabel(kind, row)}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {expand ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label={t("catalog.closeAria")} onClick={() => setExpand(null)} />
          <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl border border-app bg-panel p-5 shadow-xl sm:rounded-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("salesList.vehicleDetails")}</h2>
              <Button type="button" size="sm" variant="ghost" onPress={() => setExpand(null)}>
                {t("common.close")}
              </Button>
            </div>
            {expand.kind === "catalog" ? (
              (() => {
                const row = expand.row as CatalogRow;
                const price = Number(row.sale_price_dzd ?? 0);
                const refs = dzdRefs(price);
                const lead = Number(row.lead_time_days ?? 0);
                const dep = Number(row.deposit_amount_dzd ?? 0);
                const photos = Array.isArray(row.photos) ? row.photos.filter((u) => typeof u === "string") : [];
                const resp =
                  String(row.buyer_responsibilities_note || "").trim() || t("salesList.buyerDefault");
                return (
                  <div className="space-y-5 text-sm">
                    <div className="rounded-lg border border-dashed border-default-300 bg-default-50 px-3 py-2 text-xs text-default-700">
                      {t("salesList.catalogNoInventoryBlurb")}
                    </div>
                    {photos.length ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {photos.slice(0, 6).map((url) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={url} src={url} alt="" className="h-28 w-full rounded-md object-cover" />
                        ))}
                      </div>
                    ) : null}
                    <div>
                      <p className="text-xs font-semibold uppercase text-default-500">{t("salesList.pricing")}</p>
                      <p className="text-2xl font-bold text-app">{moneyDzd(price)}</p>
                      <p className="mt-1 text-xs text-default-500">
                        {t("salesList.referenceFx", {
                          usd: formatNumberForLocale(locale, refs.usd, { maximumFractionDigits: 0 }),
                          aed: formatNumberForLocale(locale, refs.aed, { maximumFractionDigits: 0 }),
                        })}
                      </p>
                      <p className="mt-2 text-default-700">
                        {t("salesList.leadDepositLine", {
                          lead:
                            lead > 0 ? t("salesList.leadDays", { n: lead }) : t("salesList.contactManager"),
                          deposit: dep > 0 ? moneyDzd(dep) : t("common.emiDash"),
                        })}
                      </p>
                      <p className="mt-1 text-xs text-default-600">{t("salesList.depositPolicy")}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-default-500">{t("salesList.buyerResp")}</p>
                      <p className="text-default-700">{resp}</p>
                    </div>
                    {canSeeInternal ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                        <p className="font-semibold">{t("salesList.managerOwner")}</p>
                        {row.cost_estimate_dzd != null ? (
                          <p>{t("salesList.costEstimate", { amount: moneyDzd(Number(row.cost_estimate_dzd)) })}</p>
                        ) : null}
                        {row.margin_note ? (
                          <p className="mt-1">{t("salesList.marginLine", { note: String(row.margin_note) })}</p>
                        ) : null}
                        {row.internal_note ? (
                          <p className="mt-1 whitespace-pre-wrap">
                            {t("salesList.internalLine", { note: String(row.internal_note) })}
                          </p>
                        ) : null}
                        {row.supplier_reference ? (
                          <p className="mt-1">{t("salesList.supplierRef", { ref: String(row.supplier_reference) })}</p>
                        ) : null}
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant="primary"
                      className="w-full"
                      onPress={() => {
                        primaryAction(expand.kind, expand.row);
                        setExpand(null);
                      }}
                    >
                      {primaryLabel(expand.kind, expand.row)}
                    </Button>
                  </div>
                );
              })()
            ) : carDetailLoading ? (
              <div className="flex justify-center py-12">
                <Spinner color="danger" />
              </div>
            ) : carDetailError ? (
              <Alert.Root status="danger">
                <Alert.Content>
                  <Alert.Description>{carDetailError}</Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ) : carDetail ? (
              (() => {
                const car = carDetail.car;
                const price = Number(car.sale_price_dzd ?? 0);
                const refs = dzdRefs(price);
                const lead = Number(car.sales_lead_time_days ?? 0);
                const dep = Number(car.sales_deposit_dzd ?? 0);
                const photos = Array.isArray(car.photos) ? car.photos.filter((u) => typeof u === "string") : [];
                const title = `${car.brand ?? ""} ${car.model ?? ""} ${car.year ?? ""}`.trim();
                const life = badgeForCar(car as CarRow);
                const po = carDetail.purchase_order;
                const cont = carDetail.container;
                const createdRaw = car.created_at ? new Date(String(car.created_at)) : null;
                const daysInv =
                  createdRaw && !Number.isNaN(createdRaw.getTime())
                    ? Math.max(0, Math.floor((Date.now() - createdRaw.getTime()) / 86400000))
                    : null;
                const carId = String(car.id || "");

                const specLine = (label: string, val: unknown) => {
                  if (val == null || val === "") return null;
                  const s = Array.isArray(val) ? val.join(", ") : String(val);
                  if (!s.trim()) return null;
                  return (
                    <div key={label} className="flex flex-wrap gap-x-2 text-sm">
                      <span className="text-default-500">{label}</span>
                      <span className="font-medium text-app">{s}</span>
                    </div>
                  );
                };

                return (
                  <div className="space-y-5 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-app pb-3">
                      <div>
                        <h3 className="text-base font-semibold leading-snug">{title || t("salesList.vehicleFallback")}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-default-600">
                          {car.grade ? (
                            <span>{t("salesList.gradeLabel", { grade: String(car.grade) })}</span>
                          ) : null}
                          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-default-600">
                            {life}
                          </span>
                        </div>
                        {car.vin ? <p className="mt-1 font-mono text-xs text-default-600">VIN {String(car.vin)}</p> : null}
                      </div>
                    </div>

                    {photos.length ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase text-default-500">{t("salesList.photos")}</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {photos.map((url) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={url} src={url} alt="" className="h-32 w-full rounded-md object-cover" />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <p className="text-xs font-semibold uppercase text-default-500">{t("salesList.pricing")}</p>
                      <p className="text-2xl font-bold text-app">{moneyDzd(price)}</p>
                      <p className="mt-1 text-xs text-default-500">
                        {t("salesList.referenceFx", {
                          usd: formatNumberForLocale(locale, refs.usd, { maximumFractionDigits: 0 }),
                          aed: formatNumberForLocale(locale, refs.aed, { maximumFractionDigits: 0 }),
                        })}
                      </p>
                      <p className="mt-2 text-default-700">
                        {t("salesList.leadDepositLine", {
                          lead: lead > 0 ? t("salesList.leadDays", { n: lead }) : t("common.emiDash"),
                          deposit: dep > 0 ? moneyDzd(dep) : t("common.emiDash"),
                        })}
                      </p>
                      <p className="mt-1 text-xs text-default-600">{t("salesList.depositPolicy")}</p>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-default-500">{t("salesList.vehicleSpecs")}</p>
                      <div className="space-y-1 rounded-md border border-app bg-white/50 p-3">
                        {specLine(t("salesList.specColor"), car.color)}
                        {specLine(
                          t("salesList.specMileage"),
                          car.mileage != null
                            ? t("salesList.kmSuffix", { n: Number(car.mileage) })
                            : null
                        )}
                        {specLine(t("salesList.specBody"), car.body_type)}
                        {specLine(t("salesList.specDrive"), car.drive_type)}
                        {specLine(t("salesList.specDoors"), car.doors)}
                        {specLine(t("salesList.specSeats"), car.seats)}
                        {specLine(t("salesList.specTransmission"), car.transmission)}
                        {specLine(t("salesList.specFuel"), car.fuel_type)}
                        {specLine(t("salesList.specEngine"), car.engine)}
                        {specLine(t("salesList.specCondition"), car.condition)}
                        {specLine(t("salesList.specOrigin"), car.country_of_origin)}
                        {specLine(t("salesList.specInterior"), car.interior_color)}
                        {specLine(t("salesList.specBodyIssues"), car.body_issues)}
                        {specLine(t("salesList.specFeatures"), car.features)}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-default-500">{t("salesList.logistics")}</p>
                      <div className="space-y-2 rounded-md border border-app bg-white/50 p-3">
                        {po && typeof po.id === "string" ? (
                          <p>
                            <span className="text-default-500">{t("salesList.purchaseOrderPrefix")} </span>
                            <Link
                              href={`/purchase-orders/${encodeURIComponent(po.id)}`}
                              className="font-medium text-[var(--color-accent)] underline"
                            >
                              {String(po.po_number || po.id).slice(0, 48)}
                            </Link>
                            {po.status ? <span className="text-default-500"> · {String(po.status)}</span> : null}
                          </p>
                        ) : (
                          <p className="text-default-600">{t("salesList.noPurchaseOrderLinked")}</p>
                        )}
                        {cont ? (
                          <p>
                            <span className="text-default-500">{t("salesList.containerPrefix")} </span>
                            <span className="font-medium">
                              {String(cont.ref || cont.id || t("common.emiDash"))}
                              {cont.status ? ` · ${String(cont.status)}` : ""}
                            </span>
                          </p>
                        ) : (
                          <p className="text-default-600">{t("salesList.notAssignedContainer")}</p>
                        )}
                        <p>
                          <span className="text-default-500">{t("salesList.stockLocation")} </span>
                          <span className="font-medium">{car.location ? String(car.location) : t("common.emiDash")}</span>
                        </p>
                        {carDetail.status_timeline.length ? (
                          <div className="mt-2 border-t border-app pt-2">
                            <p className="text-[11px] font-semibold text-default-500">{t("salesList.statusTimeline")}</p>
                            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-[11px]">
                              {carDetail.status_timeline.map((e, i) => (
                                <li key={`${e.changed_at}-${i}`} className="text-default-700">
                                  <span className="font-mono text-[10px] text-default-400">
                                    {formatDateForLocale(locale, e.changed_at, {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    })}
                                  </span>{" "}
                                  <span className="font-semibold">{e.field_name}</span>: {e.old_value ?? t("common.emiDash")} →{" "}
                                  {e.new_value}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-md border border-app bg-white/50 p-3">
                      <SalesNotesField
                        value={String(car.sales_notes ?? "")}
                        onChange={(v) =>
                          setCarDetail((prev) =>
                            prev ? { ...prev, car: { ...prev.car, sales_notes: v } } : prev
                          )
                        }
                        readOnly={!canEditSalesNotes}
                        lastUpdatedAt={(car.sales_notes_updated_at as string | null) ?? null}
                        lastUpdatedByName={carDetail.sales_notes_updated_by_name}
                        onSave={async (text) => {
                          const res = await fetch(`/api/sales-list/cars/${encodeURIComponent(carId)}/notes`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ sales_notes: text }),
                          });
                          const data = (await res.json().catch(() => ({}))) as SalesNotesSaveResult & { error?: string };
                          if (!res.ok) throw new Error(data.error || t("salesList.failedSaveNotes"));
                          setCarDetail((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  sales_notes_updated_by_name: data.sales_notes_updated_by_name ?? null,
                                  car: {
                                    ...prev.car,
                                    sales_notes: data.sales_notes,
                                    sales_notes_updated_at: data.sales_notes_updated_at,
                                    sales_notes_updated_by: data.sales_notes_updated_by,
                                  },
                                }
                              : prev
                          );
                          return data;
                        }}
                      />
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-default-500">{t("salesList.internalHeading")}</p>
                      <div className="space-y-2 rounded-md border border-app bg-white/50 p-3 text-sm">
                        {daysInv != null ? (
                          <p>{t("salesList.daysInInventoryCount", { n: daysInv })}</p>
                        ) : null}
                        {carDetail.linked_deals.length ? (
                          <div>
                            <p className="text-default-500">{t("salesList.linkedDeals")}</p>
                            <ul className="mt-1 list-inside list-disc space-y-1 text-[13px]">
                              {carDetail.linked_deals.map((d) => (
                                <li key={String(d.id)}>
                                  {String(d.client_name || t("salesList.clientFallback"))} ·{" "}
                                  {String(d.status || t("common.emiDash"))} ·{" "}
                                  <Link href="/deals" className="text-[var(--color-accent)] underline">
                                    {t("salesList.openDeals")}
                                  </Link>
                                  <span className="ml-1 font-mono text-[10px] text-default-400">({String(d.id).slice(0, 8)}…)</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-default-600">{t("salesList.noLinkedDeals")}</p>
                        )}
                        {canSeeInternal ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                            <p className="font-semibold">{t("salesList.marginSourcing")}</p>
                            {car.sales_cost_estimate_dzd != null ? (
                              <p>{t("salesList.costEstimate", { amount: moneyDzd(Number(car.sales_cost_estimate_dzd)) })}</p>
                            ) : null}
                            {car.sales_internal_note ? (
                              <p className="mt-1 whitespace-pre-wrap">{String(car.sales_internal_note)}</p>
                            ) : null}
                            {car.supplier_name ? (
                              <p className="mt-1">{t("inventory.supplierPrefix", { name: String(car.supplier_name) })}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      className="w-full"
                      onPress={() => {
                        primaryAction(expand.kind, expand.row);
                        setExpand(null);
                      }}
                    >
                      {primaryLabel(expand.kind, expand.row)}
                    </Button>
                  </div>
                );
              })()
            ) : null}
          </div>
        </div>
      ) : null}

      {isStaff && !isManager && !isOwnerLike ? (
        <p className="text-center text-[11px] text-default-400">Prices and commercial terms are owner-set. Contact a manager to discuss exceptions.</p>
      ) : null}
    </main>
  );
}
