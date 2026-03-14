import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://rcodmxamakoklzezjxyi.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjb2RteGFtYWtva2x6ZXpqeHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDExMzAsImV4cCI6MjA4ODU3NzEzMH0.ae3ueUIeEVtMfuGMB5xFokI47X_PvT5B_d0FJ_xRf-8";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Ignored when called from Server Component
        }
      },
    },
  });
}
