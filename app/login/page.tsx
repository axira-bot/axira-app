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
    router.refresh();
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Axira Trading FZE
          </h1>
          <p className="mt-1 text-sm font-medium text-[#c0392b]">Sign in</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-md border border-[#222222] bg-[#111111] px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#c0392b] focus:ring-1 focus:ring-[#c0392b]"
              placeholder="you@company.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-[#222222] bg-[#111111] px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#c0392b] focus:ring-1 focus:ring-[#c0392b]"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#c0392b] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#a03020] disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-center text-xs text-zinc-500">
          Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
