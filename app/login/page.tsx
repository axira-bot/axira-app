"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message ?? "Invalid email or password.");
      return;
    }
    router.replace("/dashboard");
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: "var(--color-bg)" }}
    >
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}
          >
            Axira Trading FZE
          </h1>
          <p className="mt-1 text-sm font-medium" style={{ color: "var(--color-accent)" }}>
            Sign in
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span
              className="mb-1 block text-xs font-medium"
              style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}
            >
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="input w-full px-3 py-2 text-sm placeholder:opacity-60"
              style={{ color: "var(--color-text)" }}
              placeholder="you@company.com"
            />
          </label>
          <label className="block">
            <span
              className="mb-1 block text-xs font-medium"
              style={{ fontFamily: "var(--font-body)", color: "var(--color-text-muted)" }}
            >
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="input w-full px-3 py-2 text-sm placeholder:opacity-60"
              style={{ color: "var(--color-text)" }}
              placeholder="••••••••"
            />
          </label>
          {error && (
            <div
              className="rounded-md border px-3 py-2 text-xs"
              style={{
                borderColor: "var(--color-primary)",
                background: "rgba(91,15,21,0.4)",
                color: "var(--color-text)",
              }}
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p
          className="text-center text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
