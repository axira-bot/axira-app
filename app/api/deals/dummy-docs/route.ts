import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type DummyDocPayload = {
  client_name?: string;
  client_phone?: string | null;
  client_passport?: string | null;
  car_brand?: string;
  car_model?: string;
  car_year?: number | null;
  car_color?: string | null;
  car_vin?: string | null;
  country_of_origin?: string | null;
  amount_usd?: number;
  export_to?: string | null;
  notes?: string | null;
};

type DummyDocRow = {
  id: string;
  client_name: string;
  client_phone: string | null;
  client_passport: string | null;
  car_brand: string;
  car_model: string;
  car_year: number | null;
  car_color: string | null;
  car_vin: string | null;
  country_of_origin: string | null;
  amount_usd: number;
  export_to: string | null;
  notes: string | null;
  created_at: string | null;
  created_by: string | null;
};

const DUMMY_DOCS_FALLBACK_KEY = "dummy_docs_records";

function parseFallbackRows(value: string | null | undefined): DummyDocRow[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as DummyDocRow[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("client_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      const isMissingTable =
        error.code === "42P01" || /client_documents/i.test(error.message || "");
      if (!isMissingTable) return NextResponse.json({ error: error.message }, { status: 500 });

      const { data: fallbackRow, error: fallbackError } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", DUMMY_DOCS_FALLBACK_KEY)
        .maybeSingle();
      if (fallbackError) return NextResponse.json({ error: fallbackError.message }, { status: 500 });
      const rows = parseFallbackRows((fallbackRow as { value?: string | null } | null)?.value)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .slice(0, 100);
      return NextResponse.json({ rows });
    }
    return NextResponse.json({ rows: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as DummyDocPayload;
    if (!body.client_name?.trim()) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }
    if (!body.car_brand?.trim() || !body.car_model?.trim()) {
      return NextResponse.json({ error: "Car brand and model are required." }, { status: 400 });
    }
    const amountUsd = Number(body.amount_usd ?? 0);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return NextResponse.json({ error: "Amount USD must be greater than zero." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("client_documents")
      .insert({
        client_name: body.client_name.trim(),
        client_phone: body.client_phone?.trim() || null,
        client_passport: body.client_passport?.trim() || null,
        car_brand: body.car_brand.trim(),
        car_model: body.car_model.trim(),
        car_year: body.car_year ?? null,
        car_color: body.car_color?.trim() || null,
        car_vin: body.car_vin?.trim() || null,
        country_of_origin: body.country_of_origin?.trim() || null,
        amount_usd: amountUsd,
        export_to: body.export_to?.trim() || "Algeria",
        notes: body.notes?.trim() || null,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (error) {
      const isMissingTable =
        error.code === "42P01" || /client_documents/i.test(error.message || "");
      if (!isMissingTable) return NextResponse.json({ error: error.message }, { status: 500 });

      const { data: fallbackRow, error: fallbackLoadError } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", DUMMY_DOCS_FALLBACK_KEY)
        .maybeSingle();
      if (fallbackLoadError) {
        return NextResponse.json({ error: fallbackLoadError.message }, { status: 500 });
      }

      const existing = parseFallbackRows((fallbackRow as { value?: string | null } | null)?.value);
      const row: DummyDocRow = {
        id: crypto.randomUUID(),
        client_name: body.client_name.trim(),
        client_phone: body.client_phone?.trim() || null,
        client_passport: body.client_passport?.trim() || null,
        car_brand: body.car_brand.trim(),
        car_model: body.car_model.trim(),
        car_year: body.car_year ?? null,
        car_color: body.car_color?.trim() || null,
        car_vin: body.car_vin?.trim() || null,
        country_of_origin: body.country_of_origin?.trim() || null,
        amount_usd: amountUsd,
        export_to: body.export_to?.trim() || "Algeria",
        notes: body.notes?.trim() || null,
        created_at: new Date().toISOString(),
        created_by: user.id,
      };

      const { error: fallbackSaveError } = await admin
        .from("app_settings")
        .upsert(
          {
            key: DUMMY_DOCS_FALLBACK_KEY,
            value: JSON.stringify([row, ...existing].slice(0, 250)),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      if (fallbackSaveError) {
        return NextResponse.json({ error: fallbackSaveError.message }, { status: 500 });
      }
      return NextResponse.json({ row }, { status: 201 });
    }
    return NextResponse.json({ row: data }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
