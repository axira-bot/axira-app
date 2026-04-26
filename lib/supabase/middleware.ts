import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://rcodmxamakoklzezjxyi.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjb2RteGFtYWtva2x6ZXpqeHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDExMzAsImV4cCI6MjA4ODU3NzEzMH0.ae3ueUIeEVtMfuGMB5xFokI47X_PvT5B_d0FJ_xRf-8";

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
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return response;
  }

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Hard gate admin users page to owner only.
  if (path.startsWith("/admin/users")) {
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || (profile as { role?: string } | null)?.role !== "owner") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}
