"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/activity", label: "Activity" },
  { href: "/inventory", label: "Inventory" },
  { href: "/deals", label: "Deals" },
  { href: "/containers", label: "Containers" },
  { href: "/movements", label: "Movements" },
  { href: "/transfers", label: "Transfers" },
  { href: "/debts", label: "Debts" },
  { href: "/employees", label: "Employees" },
  { href: "/investors", label: "Investors" },
  { href: "/reports", label: "Reports" },
  { href: "/clients", label: "Clients" },
];

function roleLabel(role: string | null): string {
  if (!role) return "";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function visibleHrefsForRole(role: string | null): Set<string> {
  if (!role) return new Set();
  if (role === "owner") return new Set(navItems.map((i) => i.href)).add("/admin/users");
  if (role === "staff") return new Set(["/inventory", "/deals", "/clients"]);
  if (role === "accountant") return new Set(["/movements", "/reports", "/activity"]);
  if (role === "investor") return new Set(["/investors"]);
  if (role === "manager") {
    return new Set(
      navItems
        .filter((i) => i.href !== "/transfers" && i.href !== "/employees" && i.href !== "/investors")
        .map((i) => i.href)
    );
  }
  return new Set();
}

function AxiraLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0">
      <polygon points="20,2 38,36 2,36" fill="none" stroke="#C9A84C" strokeWidth="2" />
      <polygon points="20,10 32,34 8,34" fill="#C9A84C" opacity="0.15" />
      <polygon points="20,18 28,32 12,32" fill="#C9A84C" />
    </svg>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center w-9 h-9 rounded-md md:hidden"
      style={{ color: "#C9A84C" }}
      aria-label="Open menu"
    >
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="6" x2="19" y2="6" />
        <line x1="3" y1="12" x2="19" y2="12" />
        <line x1="3" y1="18" x2="19" y2="18" />
      </svg>
    </button>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, role } = useAuth();
  const visibleHrefs = visibleHrefsForRole(role);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="relative flex flex-1 flex-col h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]" aria-hidden>
        <svg width="100%" height="100%" className="h-full w-full">
          <defs>
            <pattern id="hex" width="20" height="20" patternUnits="userSpaceOnUse">
              <polygon points="10,1 19,5.5 19,14.5 10,19 1,14.5 1,5.5" fill="none" stroke="#C9A84C" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hex)" />
        </svg>
      </div>

      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-6">
          <div className="flex items-center gap-3">
            <AxiraLogo />
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold tracking-wide" style={{ fontFamily: "var(--font-heading)", color: "#C9A84C" }}>AXIRA</span>
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-body)", color: "rgba(245,237,216,0.6)" }}>Auto Export</span>
            </div>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="p-1 rounded" style={{ color: "rgba(245,237,216,0.6)" }}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          )}
        </div>

        <div className="mx-4 h-px shrink-0" style={{ background: "rgba(201,168,76,0.4)" }} />

        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
          {navItems.map((item) =>
            visibleHrefs.has(item.href) ? (
              <Link key={item.href} href={item.href} onClick={onClose}
                className={`rounded-md px-3 py-2.5 text-sm font-medium transition border-l-[3px] border-transparent ${pathname === item.href ? "border-[#C9A84C] bg-black/20 pl-[calc(0.75rem-3px)] text-[#C9A84C]" : "text-[rgba(245,237,216,0.5)] hover:bg-black/10 hover:text-[#F5EDD8]"}`}
                style={{ fontFamily: "var(--font-heading)" }}>
                {item.label}
              </Link>
            ) : null
          )}
          {visibleHrefs.has("/admin/users") && (
            <Link href="/admin/users" onClick={onClose}
              className={`rounded-md px-3 py-2.5 text-sm font-medium transition border-l-[3px] border-transparent ${pathname === "/admin/users" ? "border-[#C9A84C] bg-black/20 pl-[calc(0.75rem-3px)] text-[#C9A84C]" : "text-[rgba(245,237,216,0.5)] hover:bg-black/10 hover:text-[#F5EDD8]"}`}
              style={{ fontFamily: "var(--font-heading)" }}>Users</Link>
          )}
        </nav>

        <div className="border-t px-4 py-3" style={{ borderColor: "rgba(201,168,76,0.2)" }}>
          <p className="truncate text-sm font-medium" style={{ fontFamily: "var(--font-body)", color: "#F5EDD8" }}>Welcome, {profile?.name?.trim() || "User"}</p>
          {role && <p className="mt-0.5 text-xs" style={{ fontFamily: "var(--font-body)", color: "rgba(245,237,216,0.5)" }}>{roleLabel(role)}</p>}
          <button type="button" onClick={handleLogout} className="mt-2 flex items-center gap-2 text-xs font-medium transition hover:opacity-80" style={{ fontFamily: "var(--font-body)", color: "rgba(245,237,216,0.7)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-30 hidden md:flex h-full w-[240px] flex-col" style={{ background: "#5B0F15" }}>
      <SidebarContent />
    </aside>
  );
}

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="absolute left-0 top-0 h-full w-[280px] flex flex-col" style={{ background: "#5B0F15" }}>
        <SidebarContent onClose={onClose} />
      </aside>
    </div>
  );
}
