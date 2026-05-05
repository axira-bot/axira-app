"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner } from "@heroui/react";
import Sidebar, { MobileDrawer, MobileMenuButton } from "@/components/Sidebar";
import Header from "@/components/Header";
import { useAuth } from "@/lib/context/AuthContext";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":   "Dashboard",
  "/audit":       "Audit log",
  "/activity":    "Activity",
  "/inventory":   "Inventory",
  "/deals":       "Deals",
  "/containers":  "Containers",
  "/movements":   "Movements",
  "/transfers":   "Transfers",
  "/debts":       "Debts",
  "/employees":   "Employees",
  "/payroll":     "Payroll",
  "/investors":   "Investors",
  "/reports":     "Reports",
  "/clients":     "Clients",
  "/suppliers":   "Suppliers",
  "/admin/users": "Users",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const segment = pathname.split("/")[1];
  if (segment && PAGE_TITLES[`/${segment}`]) return PAGE_TITLES[`/${segment}`];
  return "Axira";
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isLogin = pathname === "/login";
  const [mobileOpen, setMobileOpen] = useState(false);
  const prefetchTargets = [
    "/dashboard",
    "/inventory",
    "/deals",
    "/containers",
    "/movements",
    "/reports",
    "/payroll",
  ] as const;

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    if (loading) return;
    if (!user && !isLogin) {
      router.replace("/login");
    }
  }, [loading, user, isLogin, router]);

  useEffect(() => {
    if (!user || loading || isLogin) return;
    prefetchTargets.forEach((href) => {
      if (href !== pathname) router.prefetch(href);
    });
  }, [user, loading, isLogin, pathname, router]);

  if (loading) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4"
        style={{ background: "var(--color-bg)" }}
      >
        <Spinner size="lg" color="danger" />
        <span className="text-sm text-default-500">Loading…</span>
      </div>
    );
  }

  if (!user && !isLogin) return null;
  if (isLogin) return <>{children}</>;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-bg)" }}>
      <Sidebar />

      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col md:ml-[240px]">

        <div
          className="card flex items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-3 md:hidden"
          style={{
            background: "var(--color-sidebar)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <MobileMenuButton onPress={() => setMobileOpen(true)} />
          <div className="flex items-center gap-2 flex-1">
            <svg width="20" height="20" viewBox="0 0 40 40">
              <polygon points="20,2 38,36 2,36" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
              <polygon points="20,18 28,32 12,32" fill="#C41230" />
            </svg>
            <span
              className="text-sm font-bold tracking-[0.15em]"
              style={{ color: "#FFFFFF", fontFamily: "var(--font-brand)" }}
            >
              AXIRA
            </span>
          </div>
          <span
            className="text-sm font-medium"
            style={{ color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-body)" }}
          >
            {getPageTitle(pathname)}
          </span>
        </div>

        <Header />

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
