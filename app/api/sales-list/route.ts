import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesListRead } from "@/lib/services/salesList/access";

export const dynamic = "force-dynamic";

function supplierListingBlocked(car: {
  stock_type?: string | null;
  purchase_order_id?: string | null;
}): boolean {
  return car.stock_type === "supplier" && !car.purchase_order_id;
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

export async function GET(request: NextRequest) {
  const auth = await requireSalesListRead();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const search = (sp.get("search") || "").trim();
  const brand = (sp.get("brand") || "").trim();
  const minPrice = sp.get("minPrice") ? Number(sp.get("minPrice")) : null;
  const maxPrice = sp.get("maxPrice") ? Number(sp.get("maxPrice")) : null;
  const sort = (sp.get("sort") || "price_asc").toLowerCase();

  const admin = createAdminClient();

  const carSelect =
    "id, brand, model, year, color, vin, photos, sale_price_dzd, sales_lead_time_days, sales_deposit_dzd, sales_internal_note, sales_cost_estimate_dzd, inventory_lifecycle_status, status, stock_type, purchase_order_id, linked_deal_id, notes, supplier_name";

  const [{ data: carsRaw, error: carsErr }, { data: catalogRaw, error: catErr }] = await Promise.all([
    admin.from("cars").select(carSelect).order("created_at", { ascending: false }),
    admin.from("sales_catalog_entries").select("*").eq("active", true).order("brand", { ascending: true }),
  ]);

  if (carsErr) return NextResponse.json({ error: carsErr.message }, { status: 400 });
  if (catErr) return NextResponse.json({ error: catErr.message }, { status: 400 });

  const cars = (carsRaw ?? []) as Record<string, unknown>[];

  const availableNow = cars.filter((c) => {
    if (supplierListingBlocked(c as never)) return false;
    if (String(c.status || "").toLowerCase() === "sold") return false;
    if (c.linked_deal_id) return false;
    const life = String(c.inventory_lifecycle_status || "").toUpperCase();
    if (life !== "IN_STOCK") return false;
    const price = Number(c.sale_price_dzd ?? 0);
    if (price <= 0) return false;
    if (!matchesSearch(c as never, search)) return false;
    if (!matchesBrand(c as never, brand)) return false;
    if (!matchesPriceRange(price, minPrice, maxPrice)) return false;
    return true;
  });

  const comingSoon = cars.filter((c) => {
    if (supplierListingBlocked(c as never)) return false;
    if (String(c.status || "").toLowerCase() === "sold") return false;
    if (c.linked_deal_id) return false;
    const life = String(c.inventory_lifecycle_status || "").toUpperCase();
    if (!["IN_TRANSIT", "INCOMING", "AT_PORT"].includes(life)) return false;
    const price = Number(c.sale_price_dzd ?? 0);
    if (price <= 0) return false;
    if (!matchesSearch(c as never, search)) return false;
    if (!matchesBrand(c as never, brand)) return false;
    if (!matchesPriceRange(price, minPrice, maxPrice)) return false;
    return true;
  });

  let catalog = (catalogRaw ?? []) as Record<string, unknown>[];
  catalog = catalog.filter((c) => {
    const price = Number(c.sale_price_dzd ?? 0);
    if (!matchesSearch(c as never, search)) return false;
    if (!matchesBrand(c as never, brand)) return false;
    if (!matchesPriceRange(price, minPrice, maxPrice)) return false;
    return true;
  });

  const sortCars = (rows: Record<string, unknown>[]) => {
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
  };

  const sortCatalog = (rows: Record<string, unknown>[]) => {
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
  };

  const mapCars = (rows: Record<string, unknown>[]) =>
    sortCars(rows).map((r) => (auth.canSeeInternal ? r : stripCarForStaff(r)));

  const mapCatalog = (rows: Record<string, unknown>[]) =>
    sortCatalog(rows).map((r) => (auth.canSeeInternal ? r : stripCatalogForStaff(r)));

  const brands = new Set<string>();
  for (const c of cars) {
    const b = String(c.brand || "").trim();
    if (b) brands.add(b);
  }
  for (const c of catalog) {
    const b = String(c.brand || "").trim();
    if (b) brands.add(b);
  }

  return NextResponse.json({
    availableNow: mapCars(availableNow),
    comingSoon: mapCars(comingSoon),
    orderOnDemand: mapCatalog(catalog),
    brands: [...brands].sort((a, b) => a.localeCompare(b)),
  });
}
