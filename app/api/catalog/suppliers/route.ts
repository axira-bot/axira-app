import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreorderAccess } from "@/lib/services/preorders/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requirePreorderAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const supplierId = url.searchParams.get("supplier_id");
    const admin = createAdminClient();

    if (supplierId) {
      const { data, error } = await admin
        .from("supplier_catalog")
        .select("id, supplier_id, brand, model, year, trim, color_options, base_cost, base_currency, lead_time_days, active")
        .eq("supplier_id", supplierId)
        .eq("active", true)
        .order("brand", { ascending: true });
      if (error) return NextResponse.json([]);
      return NextResponse.json(data ?? []);
    }

    const { data, error } = await admin
      .from("suppliers")
      .select("id, name, country, default_currency, active")
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) return NextResponse.json([]);

    return NextResponse.json(data ?? []);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
