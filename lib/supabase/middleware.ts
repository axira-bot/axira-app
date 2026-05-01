import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { resolvePermissions } from "@/lib/auth/permissions";
import { type FeatureKey } from "@/lib/auth/featureKeys";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://rcodmxamakoklzezjxyi.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjb2RteGFtYWtva2x6ZXpqeHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDExMzAsImV4cCI6MjA4ODU3NzEzMH0.ae3ueUIeEVtMfuGMB5xFokI47X_PvT5B_d0FJ_xRf-8";

function isOwnerLikeRole(role: string | null | undefined): boolean {
  const normalized = (role || "").toLowerCase();
  return normalized === "owner" || normalized === "super_admin" || normalized === "admin";
}

const ROUTE_FEATURE_GATES: Array<{ prefix: string; feature: FeatureKey }> = [
  { prefix: "/dashboard", feature: "dashboard" },
  { prefix: "/activity", feature: "activity" },
  { prefix: "/inventory", feature: "inventory" },
  { prefix: "/deals", feature: "deals" },
  { prefix: "/containers", feature: "containers" },
  { prefix: "/movements", feature: "movements" },
  { prefix: "/transfers", feature: "transfers" },
  { prefix: "/debts", feature: "debts" },
  { prefix: "/employees", feature: "employees" },
  { prefix: "/payroll", feature: "payroll" },
  { prefix: "/investors", feature: "investors" },
  { prefix: "/reports", feature: "reports" },
  { prefix: "/clients", feature: "clients" },
  { prefix: "/inquiries", feature: "inquiries" },
  { prefix: "/purchase-orders", feature: "purchase_orders" },
  { prefix: "/suppliers", feature: "suppliers" },
];

function roleFallbackAllows(role: string, feature: FeatureKey): boolean {
  if (isOwnerLikeRole(role)) return true;
  if (role === "staff") return ["inventory", "deals", "clients", "inquiries", "purchase_orders"].includes(feature);
  if (role === "accountant") return ["movements", "reports", "activity", "payroll"].includes(feature);
  if (role === "investor") return feature === "investors";
  if (role === "manager") {
    return [
      "dashboard",
      "activity",
      "inventory",
      "deals",
      "containers",
      "movements",
      "debts",
      "payroll",
      "reports",
      "clients",
      "inquiries",
      "purchase_orders",
      "suppliers",
    ].includes(feature);
  }
  return false;
}

function defaultRouteForRole(role: string): string {
  if (isOwnerLikeRole(role)) return "/dashboard";
  if (role === "manager") return "/dashboard";
  if (role === "staff") return "/deals";
  if (role === "accountant") return "/movements";
  if (role === "investor") return "/investors";
  return "/dashboard";
}

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Let API routes handle their own auth
  if (path.startsWith("/api/")) {
    return response;
  }

  // Stale/invalid refresh token in cookies: clear Supabase auth cookies once, then continue as signed out.
  if (authError?.code === "refresh_token_not_found") {
    request.cookies
      .getAll()
      .filter((c) => c.name.startsWith("sb-"))
      .forEach((c) => {
        response.cookies.set(c.name, "", { path: "/", maxAge: 0 });
      });
  }

  if (path === "/login") {
    if (user) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const loginRole =
        ((profile as { role?: string } | null)?.role ||
          (user.user_metadata as { role?: string } | null)?.role ||
          (user.app_metadata as { role?: string } | null)?.role ||
          "staff")
          .toLowerCase();
      return NextResponse.redirect(new URL(defaultRouteForRole(loginRole), request.url));
    }
    return response;
  }

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Hard gate admin users page to owner only.
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const profileRole = (profile as { role?: string } | null)?.role ?? null;
  const metadataRole =
    (user.user_metadata as { role?: string } | null)?.role ??
    (user.app_metadata as { role?: string } | null)?.role ??
    null;
  const effectiveRole = (profileRole || metadataRole || "staff").toLowerCase();

  if (path.startsWith("/admin/users")) {
    if (profileError || !isOwnerLikeRole(effectiveRole)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  if (!profileError && !isOwnerLikeRole(effectiveRole)) {
    const gate = ROUTE_FEATURE_GATES.find((r) => path.startsWith(r.prefix));
    if (gate) {
      let allowed = roleFallbackAllows(effectiveRole, gate.feature);
      try {
        const permissions = await resolvePermissions(user.id, effectiveRole);
        allowed = Boolean(permissions[gate.feature]);
      } catch {
        // Keep role-based fallback when permission table/client is unavailable.
      }
      if (!allowed) {
        const fallbackRoute = defaultRouteForRole(effectiveRole);
        if (path === fallbackRoute) {
          return NextResponse.redirect(new URL("/login", request.url));
        }
        return NextResponse.redirect(new URL(fallbackRoute, request.url));
      }
    }
  }

  return response;
}
