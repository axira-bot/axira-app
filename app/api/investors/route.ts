import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePermissions } from "@/lib/auth/permissions";
import { normalizeRole } from "@/lib/auth/roles";
import { attachDealCoreMetrics } from "@/lib/finance/attachDealCoreMetrics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const role = normalizeRole(
      (profile as { role?: string } | null)?.role ??
        (user.user_metadata as { role?: string } | null)?.role ??
        (user.app_metadata as { role?: string } | null)?.role ??
        "staff"
    );

    const permissions = await resolvePermissions(user.id, role);
    if (!permissions.investors) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const [
      { data: investors, error: investorsError },
      { data: returns, error: returnsError },
      { data: deals, error: dealsError },
      { data: settings, error: settingsError },
    ] = await Promise.all([
      admin.from("investors").select("*").order("name", { ascending: true }),
      admin.from("investor_returns").select("*").order("month", { ascending: false }),
      admin
        .from("deals")
        .select("id, date, sale_amount, sale_currency, sale_rate_to_aed, cost_amount, cost_currency, cost_rate_to_aed"),
      admin
        .from("app_settings")
        .select("key, value")
        .in("key", [
          "total_capital",
          "owner_name",
          "owner_capital",
          "owner_capital_currency",
          "business_valuation",
          "share_price",
          "total_shares",
          "available_shares",
          "owner_notes",
        ]),
    ]);

    if (investorsError || returnsError) {
      return NextResponse.json(
        { error: investorsError?.message ?? returnsError?.message ?? "Failed to load investors" },
        { status: 400 }
      );
    }

    const dealFacts =
      (deals as {
        id: string;
        date: string;
        sale_amount: number;
        sale_currency: string;
        sale_rate_to_aed: number | null;
        cost_amount: number;
        cost_currency: string;
        cost_rate_to_aed: number;
      }[]) ?? [];
    const withProfit = dealsError ? [] : await attachDealCoreMetrics(admin, dealFacts);
    const dealsForClient = withProfit.map((d) => ({
      id: d.id,
      date: d.date,
      profit: d.profit_aed,
    }));

    return NextResponse.json({
      investors: investors ?? [],
      returns: returns ?? [],
      deals: dealsForClient,
      settings: settingsError ? [] : settings ?? [],
      warnings: {
        deals: dealsError?.message ?? null,
        settings: settingsError?.message ?? null,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
