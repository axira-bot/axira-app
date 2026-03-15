"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar, { MobileDrawer, MobileMenuButton } from "@/components/Sidebar";
import Header from "@/components/Header";
import { useAuth } from "@/lib/context/AuthContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isLogin = pathname === "/login";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    if (loading) return;
    if (!user && !isLogin) {
      router.replace("/login");
      router.refresh();
    }
  }, [loading, user, isLogin, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bg)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-transparent" style={{ borderTopColor: "var(--color-accent)" }} />
      </div>
    );
  }

  if (!user && !isLogin) return null;
  if (isLogin) return <>{children}</>;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile drawer */}
      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 md:ml-[240px]">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 py-3 md:hidden border-b" style={{ background: "#5B0F15", borderColor: "rgba(201,168,76,0.2)" }}>
          <MobileMenuButton onClick={() => setMobileOpen(true)} />
          <span className="text-sm font-bold tracking-widest" style={{ color: "#C9A84C", fontFamily: "var(--font-heading)" }}>AXIRA</span>
        </div>
        <Header />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
