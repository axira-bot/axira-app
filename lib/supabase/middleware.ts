import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";
import { resolvePermissions } from "@/lib/auth/permissions";
import {
  ROUTE_PREFIX_TO_FEATURE,
  defaultRouteForRole,
  roleFallbackAllowsFeature,
} from "@/lib/auth/roleMatrix";
import { isOwnerLikeRole } from "@/lib/auth/roles";
import { resolveEffectiveRole } from "@/lib/auth/resolveUserRole";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://rcodmxamakoklzezjxyi.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjb2RteGFtYWtva2x6ZXpqeHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDExMzAsImV4cCI6MjA4ODU3NzEzMH0.ae3ueUIeEVtMfuGMB5xFokI47X_PvT5B_d0FJ_xRf-8";

function forwardAuthCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) {
    const { name, value, ...opts } = cookie;
    to.cookies.set(name, value, opts);
  }
}

function isAuthApiUnreachable(err: unknown): boolean {
  if (!err) return false;
  if (typeof AggregateError !== "undefined" && err instanceof AggregateError) {
    for (const sub of err.errors) {
      if (isAuthApiUnreachable(sub)) return true;
    }
  }
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes("fetch failed") || m.includes("network error") || m.includes("timeout")) {
      return true;
    }
    const c = (err as Error & { cause?: { code?: string } }).cause?.code;
    if (
      c === "ETIMEDOUT" ||
      c === "ECONNRESET" ||
      c === "ENOTFOUND" ||
      c === "EAI_AGAIN" ||
      c === "UND_ERR_CONNECT_TIMEOUT"
    ) {
      return true;
    }
  }
  const msg = String((err as { message?: string }).message ?? "").toLowerCase();
  return msg.includes("fetch failed") || msg.includes("timeout");
}

async function getUserForMiddleware(supabase: SupabaseClient): Promise<{
  user: User | null;
  authError: AuthError | null;
}> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!user && error && isAuthApiUnreachable(error)) {
      const { data: { session } } = await supabase.auth.getSession();
      return { user: session?.user ?? null, authError: null };
    }
    return { user: user ?? null, authError: error ?? null };
  } catch (e) {
    if (!isAuthApiUnreachable(e)) throw e;
    const { data: { session } } = await supabase.auth.getSession();
    return { user: session?.user ?? null, authError: null };
  }
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
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { user, authError } = await getUserForMiddleware(supabase);

  const path = request.nextUrl.pathname;

  if (path.startsWith("/api/")) {
    return response;
  }

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
      const loginRole = resolveEffectiveRole((profile as { role?: string } | null)?.role, user);
      const redirect = NextResponse.redirect(new URL(defaultRouteForRole(loginRole), request.url));
      forwardAuthCookies(response, redirect);
      return redirect;
    }
    return response;
  }

  if (!user) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    forwardAuthCookies(response, redirect);
    return redirect;
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const profileRole = (profile as { role?: string } | null)?.role ?? null;
  const effectiveRole = resolveEffectiveRole(profileRole, user);

  if (path.startsWith("/admin/users")) {
    if (profileError || !isOwnerLikeRole(effectiveRole)) {
      const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
      forwardAuthCookies(response, redirect);
      return redirect;
    }
    return response;
  }

  const gate = ROUTE_PREFIX_TO_FEATURE.find((r) => path.startsWith(r.prefix));
  if (gate && !profileError) {
    let allowed = roleFallbackAllowsFeature(effectiveRole, gate.feature);
    try {
      const permissions = await resolvePermissions(user.id, effectiveRole);
      allowed = Boolean(permissions[gate.feature]);
    } catch {
      // Keep role-based fallback when permission resolution fails.
    }
    if (!allowed) {
      const fallbackRoute = defaultRouteForRole(effectiveRole);
      if (path === fallbackRoute) {
        const redirect = NextResponse.redirect(new URL("/login", request.url));
        forwardAuthCookies(response, redirect);
        return redirect;
      }
      const redirect = NextResponse.redirect(new URL(fallbackRoute, request.url));
      forwardAuthCookies(response, redirect);
      return redirect;
    }
  }

  return response;
}
