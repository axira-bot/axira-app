"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/lib/context/AuthContext";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (loading) return;
    if (!user && !isLogin) {
      router.replace("/login");
      router.refresh();
    }
  }, [loading, user, isLogin, router]);

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "#0a0a0a" }}
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#c0392b] border-t-transparent" />
      </div>
    );
  }

  if (!user && !isLogin) {
    return null;
  }

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
