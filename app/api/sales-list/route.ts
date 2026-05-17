import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SALES_LIST_LIFECYCLE_BUCKETS,
  type SalesListLifecycleBucket,
  salesBucketFor,
} from "@/lib/cars/carLifecycleStatus";
import { requireSalesListRead } from "@/lib/services/salesList/access";

export const dynamic = "force-dynamic";

const SALES_SEGMENTS = ["brand_new", "used_under_three"] as const;
type SalesListSegment = (typeof SALES_SEGMENTS)[number];

/** Supplier listing without a PO is hidden unless opted in via sales_list_included. */
function supplierListingBlocked(car: {
  stock_type?: string | null;
  purchase_order_id?: string | null;
  sales_list_included?: boolean | null;
}): boolean {
  if (car.sales_list_included === true) return false;
  return car.stock_type === "supplier" && !car.purchase_order_id;
}

function parseSalesSegment(raw: string | null): SalesListSegment {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "used_under_three" || s === "used_under_3") return "used_under_three";
  return "brand_new";
}

function normalizeCondition(condition: unknown): string {
  return String(condition ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isBrandNewCar(car: Record<string, unknown>): boolean {
  const c = normalizeCondition(car.condition);
  return c === "brand new" || c === "new";
}

function isUsedCar(car: Record<string, unknown>): boolean {
  return normalizeCondition(car.condition) === "used";
}

function modelYearOrNull(car: Record<string, unknown>): number | null {
  const y = car.year;
  if (y == null || y === "") return null;
  const n = typeof y === "number" ? y : Number(String(y).trim());
  return Number.isFinite(n) ? n : null;
}

/** Outer tabs: condition = new vs used-under-3 segmentation. */
function passesSalesInventorySegment(car: Record<string, unknown>, segment: SalesListSegment): boolean {
  if (segment === "brand_new") return isBrandNewCar(car);
  if (!isUsedCar(car)) return false;
  const currentYear = new Date().getFullYear();
  const minYearInclusive = currentYear - 3;
  const yr = modelYearOrNull(car);
  if (yr != null && yr >= minYearInclusive) return true;
  return car.sales_list_included === true;
}

/** Base rules + canonical lifecycle buckets (DELIVERED excluded via salesBucketFor). */
function intrinsicSalesEligible(c: Record<string, unknown>): boolean {
  if (supplierListingBlocked(c as never)) return false;
  if (String(c.status || "").toLowerCase() === "sold") return false;
  if (c.linked_deal_id) return false;
  const price = Number(c.sale_price_dzd ?? 0);
  if (price <= 0) return false;
  return salesBucketFor(String(c.lifecycle_status ?? "")) != null;
}

function canonicalBucket(car: Record<string, unknown>): SalesListLifecycleBucket {
  const b = salesBucketFor(String(car.lifecycle_status ?? ""));
  /** intrinsicSalesEligible already ensures non-null; keep default for defensive coding. */
  return b ?? "coming_soon";
}

function stripCarForStaff<T extends Record<string, unknown>>(row: T): T {
  const { sales_internal_note: _i, sales_cost_estimate_dzd: _c, ...rest } = row;
  return rest as T;
}

function stripCatalogForStaff<T extends Record<string, unknown>>(row: T): T {
  const { internal_note: _i, cost_estimate_dzd: _c, margin_note: _m, supplier_id: _s, supplier_reference: _r, ...rest } =
    row;
  return rest as T;
}

function matchesSearch(
  row: { brand?: unknown; model?: unknown; color?: unknown; trim?: unknown },
  q: string
): boolean {
  if (!q) return true;
  const hay = [row.brand, row.model, row.color, row.trim]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  return hay.includes(q.toLowerCase());
}

function matchesBrand(row: { brand?: unknown }, brand: string): boolean {
  if (!brand) return true;
  return String(row.brand ?? "").toLowerCase() === brand.toLowerCase();
}

function matchesPriceRange(price: number, minP: number | null, maxP: number | null): boolean {
  if (minP != null && price < minP) return false;
  if (maxP != null && price > maxP) return false;
  return true;
}

function sortCars(sort: string, rows: Record<string, unknown>[]) {
  const copy = [...rows];
  copy.sort((a, b) => {
    const pa = Number(a.sale_price_dzd ?? 0);
    const pb = Number(b.sale_price_dzd ?? 0);
    const la = Number(a.sales_lead_time_days ?? 1e9);
    const lb = Number(b.sales_lead_time_days ?? 1e9);
    if (sort === "price_desc") return pb - pa;
    if (sort === "lead_asc") return la - lb;
    return pa - pb;
  });
  return copy;
}

function sortCatalog(sort: string, rows: Record<string, unknown>[]) {
  const copy = [...rows];
  copy.sort((a, b) => {
    const pa = Number(a.sale_price_dzd ?? 0);
    const pb = Number(b.sale_price_dzd ?? 0);
    const la = Number(a.lead_time_days ?? 1e9);
    const lb = Number(b.lead_time_days ?? 1e9);
    if (sort === "price_desc") return pb - pa;
    if (sort === "lead_asc") return la - lb;
    return pa - pb;
  });
  return copy;
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesListRead();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const search = (sp.get("search") || "").trim();
  const brand = (sp.get("brand") || "").trim();
  const minPrice = sp.get("minPrice") ? Number(sp.get("minPrice")) : null;
  const maxPrice = sp.get("maxPrice") ? Number(sp.get("maxPrice")) : null;
  const sort = (sp.get("sort") || "price_asc").toLowerCase();
  const segment = parseSalesSegment(sp.get("segment"));

  const admin = createAdminClient();

  const carSelect =
    "id, brand, model, year, color, vin, photos, sale_price_dzd, sales_lead_time_days, sales_deposit_dzd, sales_internal_note, sales_cost_estimate_dzd, inventory_lifecycle_status, lifecycle_status, status, stock_type, purchase_order_id, linked_deal_id, notes, supplier_name, sales_list_included, condition";

  const [{ data: carsRaw, error: carsErr }, { data: catalogRaw, error: catErr }] = await Promise.all([
    admin.from("cars").select(carSelect).order("created_at", { ascending: false }),
    admin.from("sales_catalog_entries").select("*").eq("active", true).order("brand", { ascending: true }),
  ]);

  if (carsErr) return NextResponse.json({ error: carsErr.message }, { status: 400 });
  if (catErr) return NextResponse.json({ error: catErr.message }, { status: 400 });

  const cars = (carsRaw ?? []) as Record<string, unknown>[];

  const segmentTotals: Record<SalesListSegment, number> = {
    brand_new: 0,
    used_under_three: 0,
  };

  const bucketCounts: Record<SalesListLifecycleBucket, number> = {
    available_now: 0,
    ready_for_export: 0,
    in_transit: 0,
    coming_soon: 0,
  };

  for (const seg of SALES_SEGMENTS) {
    segmentTotals[seg] = cars.filter((c) => intrinsicSalesEligible(c) && passesSalesInventorySegment(c, seg)).length;
  }

  for (const b of SALES_LIST_LIFECYCLE_BUCKETS) {
    bucketCounts[b] = cars.filter(
      (c) =>
        intrinsicSalesEligible(c) && passesSalesInventorySegment(c, segment) && canonicalBucket(c) === b
    ).length;
  }

  const passesFiltered = (c: Record<string, unknown>) => {
    const price = Number(c.sale_price_dzd ?? 0);
    if (!matchesSearch(c as never, search)) return false;
    if (!matchesBrand(c as never, brand)) return false;
    if (!matchesPriceRange(price, minPrice, maxPrice)) return false;
    return true;
  };

  const inventoryBucketsRaw: Record<SalesListLifecycleBucket, Record<string, unknown>[]> = {
    available_now: [],
    ready_for_export: [],
    in_transit: [],
    coming_soon: [],
  };

  for (const c of cars) {
    if (!intrinsicSalesEligible(c) || !passesSalesInventorySegment(c, segment)) continue;
    if (!passesFiltered(c)) continue;
    inventoryBucketsRaw[canonicalBucket(c)].push(c);
  }

  let catalog = (catalogRaw ?? []) as Record<string, unknown>[];
  catalog = catalog.filter((c) => {
    const price = Number(c.sale_price_dzd ?? 0);
    if (!matchesSearch(c as never, search)) return false;
    if (!matchesBrand(c as never, brand)) return false;
    if (!matchesPriceRange(price, minPrice, maxPrice)) return false;
    return true;
  });

  const mapCars = (rows: Record<string, unknown>[]) =>
    sortCars(sort, rows).map((r) => (auth.canSeeInternal ? r : stripCarForStaff(r)));

  const mapCatalog = (rows: Record<string, unknown>[]) =>
    sortCatalog(sort, rows).map((r) => (auth.canSeeInternal ? r : stripCatalogForStaff(r)));

  const inventoryBuckets = {
    available_now: mapCars(inventoryBucketsRaw.available_now),
    ready_for_export: mapCars(inventoryBucketsRaw.ready_for_export),
    in_transit: mapCars(inventoryBucketsRaw.in_transit),
    coming_soon: mapCars(inventoryBucketsRaw.coming_soon),
  };

  const brands = new Set<string>();
  for (const c of cars) {
    if (!intrinsicSalesEligible(c)) continue;
    if (!passesSalesInventorySegment(c, segment)) continue;
    const b = String(c.brand || "").trim();
    if (b) brands.add(b);
  }
  for (const c of catalog) {
    const b = String(c.brand || "").trim();
    if (b) brands.add(b);
  }

  return NextResponse.json({
    segment,
    segmentTotals,
    bucketCounts,
    inventoryBuckets,
    orderOnDemand: mapCatalog(catalog),
    brands: [...brands].sort((a, b) => a.localeCompare(b)),
  });
}
