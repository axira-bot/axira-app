"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Spinner } from "@heroui/react";
import { useAuth } from "@/lib/context/AuthContext";
import { hasFeature } from "@/lib/auth/permissions";
import type { FeatureKey, FeaturePermissions } from "@/lib/auth/featureKeys";
import { getRates, type AppRates } from "@/lib/rates";
import { displayFxFromAppRates } from "@/lib/finance/dealMoney";

type CarRow = Record<string, unknown>;
type CatalogRow = Record<string, unknown>;

const DEPOSIT_POLICY =
  "Deposit secures the vehicle in the buyer’s name. Balance is due per the deal schedule. Deposits may be non-refundable once ordering begins — confirm with a manager for exceptions.";

const BUYER_DEFAULT =
  "Buyer is responsible for customs clearance, import duties, local registration, and inland transport unless otherwise agreed in writing.";

function moneyDzd(n: number) {
  return `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} DZD`;
}

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
  const { permissions, loading: authLoading, isStaff, isManager, isOwnerLike } = useAuth();
  const canAccess = hasFeature(permissions as FeaturePermissions, "sales_list" as FeatureKey);
  const canSeeInternal = isManager || isOwnerLike;

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
      setError(data.error || "Failed to load sales list");
      return;
    }
    setAvailableNow((data.availableNow as CarRow[]) || []);
    setComingSoon((data.comingSoon as CarRow[]) || []);
    setOrderOnDemand((data.orderOnDemand as CatalogRow[]) || []);
    setBrands((data.brands as string[]) || []);
  }, [canAccess, search, brand, minPrice, maxPrice, sort]);

  useEffect(() => {
    void getRates().then(setRates);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!canAccess) return;
    void load();
  }, [authLoading, canAccess, load]);

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
    if (life === "IN_STOCK") return "In stock";
    if (life === "AT_PORT") return "At port";
    if (life === "IN_TRANSIT") return "In transit";
    if (life === "INCOMING") return "Incoming";
    return life || "—";
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
      return life === "IN_STOCK" ? "Create deal" : "Create pre-order";
    }
    return "Create pre-order";
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8">
        <Spinner color="danger" />
        <span className="text-sm text-default-500">Loading…</span>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <main className="p-6">
        <Alert.Root status="warning">
          <Alert.Content>
            <Alert.Title>No access</Alert.Title>
            <Alert.Description>You do not have permission to view the sales list.</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </main>
    );
  }

  return (
    <main className="min-h-full space-y-5 p-6 text-foreground" style={{ background: "var(--color-bg)" }}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Sales price list</h1>
          <p className="mt-1 max-w-2xl text-sm text-default-500">
            Algeria team: sellable cars with owner-set DZD pricing, lead times, and deposits. Use filters, then create a deal or pre-order in one click.
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-app bg-panel p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-6">
          <label className="text-xs md:col-span-2">
            <span className="text-default-500">Search</span>
            <input
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Brand, model, color…"
            />
          </label>
          <label className="text-xs">
            <span className="text-default-500">Brand</span>
            <select
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            >
              <option value="">All</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-default-500">Min DZD</span>
            <input
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              type="number"
              min={0}
            />
          </label>
          <label className="text-xs">
            <span className="text-default-500">Max DZD</span>
            <input
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              type="number"
              min={0}
            />
          </label>
          <label className="text-xs">
            <span className="text-default-500">Sort</span>
            <select className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="price_asc">Price ↑</option>
              <option value="price_desc">Price ↓</option>
              <option value="lead_asc">Lead time ↑</option>
            </select>
          </label>
        </div>
        <Button type="button" variant="primary" size="sm" onPress={() => void load()} isDisabled={loading}>
          Apply filters
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
            ["now", `Available now (${availableNow.length})`],
            ["soon", `Coming soon (${comingSoon.length})`],
            ["demand", `Order on demand (${orderOnDemand.length})`],
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
            <p className="text-sm text-default-500">No vehicles match these filters.</p>
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
                      <div className="flex h-full items-center justify-center text-xs text-default-400">No photo</div>
                    )}
                  </button>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-default-600">
                        {isCatalog ? "Catalog" : badgeForCar(row as CarRow)}
                      </span>
                      {!isCatalog && vinLast6((row as CarRow).vin) ? (
                        <span className="text-[10px] text-default-500">VIN …{vinLast6((row as CarRow).vin)}</span>
                      ) : null}
                    </div>
                    <h3 className="text-sm font-semibold leading-snug">{title}</h3>
                    <p className="text-[11px] text-default-500">
                      {[color, trim].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-lg font-bold text-app">{moneyDzd(price)}</p>
                    <p className="text-xs text-default-600">
                      Lead: {lead > 0 ? `${lead} days` : "—"} · Deposit: {dep > 0 ? moneyDzd(dep) : "—"}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      <Button type="button" size="sm" variant="outline" onPress={() => setExpand({ kind, row })}>
                        Details
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
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close" onClick={() => setExpand(null)} />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-app bg-panel p-5 shadow-xl sm:rounded-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold">Vehicle details</h2>
              <Button type="button" size="sm" variant="ghost" onPress={() => setExpand(null)}>
                Close
              </Button>
            </div>
            {(() => {
              const row = expand.row;
              const isCatalog = expand.kind === "catalog";
              const price = Number((row as { sale_price_dzd?: unknown }).sale_price_dzd ?? 0);
              const refs = dzdRefs(price);
              const lead = isCatalog
                ? Number((row as CatalogRow).lead_time_days ?? 0)
                : Number((row as CarRow).sales_lead_time_days ?? 0);
              const dep = isCatalog
                ? Number((row as CatalogRow).deposit_amount_dzd ?? 0)
                : Number((row as CarRow).sales_deposit_dzd ?? 0);
              const resp = isCatalog
                ? String((row as CatalogRow).buyer_responsibilities_note || "").trim() || BUYER_DEFAULT
                : BUYER_DEFAULT;
              return (
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="text-2xl font-bold text-app">{moneyDzd(price)}</p>
                    <p className="mt-1 text-xs text-default-500">
                      Reference: ~{refs.usd.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD · ~
                      {refs.aed.toLocaleString("en-US", { maximumFractionDigits: 0 })} AED
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-default-500">Lead time</p>
                    <p>{lead > 0 ? `${lead} days` : "Contact manager"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-default-500">Deposit</p>
                    <p>{dep > 0 ? moneyDzd(dep) : "—"}</p>
                    <p className="mt-1 text-xs text-default-600">{DEPOSIT_POLICY}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-default-500">Buyer responsibilities</p>
                    <p className="text-default-700">{resp}</p>
                  </div>
                  {canSeeInternal ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                      <p className="font-semibold">Manager / owner</p>
                      {!isCatalog ? (
                        <>
                          {(row as CarRow).sales_cost_estimate_dzd != null ? (
                            <p>Cost estimate (DZD): {moneyDzd(Number((row as CarRow).sales_cost_estimate_dzd))}</p>
                          ) : null}
                          {(row as CarRow).sales_internal_note ? (
                            <p className="mt-1 whitespace-pre-wrap">Internal: {String((row as CarRow).sales_internal_note)}</p>
                          ) : null}
                          {(row as CarRow).supplier_name ? <p className="mt-1">Supplier: {String((row as CarRow).supplier_name)}</p> : null}
                        </>
                      ) : (
                        <>
                          {(row as CatalogRow).cost_estimate_dzd != null ? (
                            <p>Cost estimate (DZD): {moneyDzd(Number((row as CatalogRow).cost_estimate_dzd))}</p>
                          ) : null}
                          {(row as CatalogRow).margin_note ? <p className="mt-1">Margin: {String((row as CatalogRow).margin_note)}</p> : null}
                          {(row as CatalogRow).internal_note ? (
                            <p className="mt-1 whitespace-pre-wrap">Internal: {String((row as CatalogRow).internal_note)}</p>
                          ) : null}
                          {(row as CatalogRow).supplier_reference ? (
                            <p className="mt-1">Supplier ref: {String((row as CatalogRow).supplier_reference)}</p>
                          ) : null}
                        </>
                      )}
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
            })()}
          </div>
        </div>
      ) : null}

      {isStaff && !isManager && !isOwnerLike ? (
        <p className="text-center text-[11px] text-default-400">Prices and commercial terms are owner-set. Contact a manager to discuss exceptions.</p>
      ) : null}
    </main>
  );
}
