"use client";

import { usePathname } from "next/navigation";
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
  "/investors":   "Investors",
  "/reports":     "Reports",
  "/clients":     "Clients",
  "/suppliers":   "Suppliers",
  "/admin/users": "Users",
  "/login":       "Login",
};

const PAGE_SUBTITLES: Record<string, string> = {
  "/dashboard":   "Overview of your business",
  "/audit":       "Who changed what — full trail",
  "/activity":    "Recent transactions & events",
  "/inventory":   "Cars in stock",
  "/deals":       "Sales & purchases",
  "/containers":  "Shipment containers",
  "/movements":   "Cash & expense tracking",
  "/transfers":   "Currency conversions",
  "/debts":       "Outstanding balances",
  "/employees":   "Team management",
  "/investors":   "Investor overview",
  "/reports":     "Financial reports",
  "/clients":     "Client directory",
  "/suppliers":   "Procurement suppliers for POs",
  "/admin/users": "User management",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const segment = pathname.split("/")[1];
  if (segment && PAGE_TITLES[`/${segment}`]) return PAGE_TITLES[`/${segment}`];
  return "Axira Trading FZE";
}

function getPageSubtitle(pathname: string): string {
  if (PAGE_SUBTITLES[pathname]) return PAGE_SUBTITLES[pathname];
  const segment = pathname.split("/")[1];
  if (segment && PAGE_SUBTITLES[`/${segment}`]) return PAGE_SUBTITLES[`/${segment}`];
  return "";
}

function getInitials(name: string | null): string {
  if (!name?.trim()) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function Header() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const title = getPageTitle(pathname);
  const subtitle = getPageSubtitle(pathname);

  return (
    <header
      className="hidden md:flex h-16 shrink-0 items-center justify-between px-6"
      style={{
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Left: page title + subtitle */}
      <div className="flex flex-col">
        <h1
          className="text-lg font-semibold leading-tight"
          style={{ color: "var(--color-text)", fontFamily: "var(--font-heading)" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs leading-tight mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button
          type="button"
          className="flex items-center justify-center w-9 h-9 rounded-lg transition"
          style={{ color: "var(--color-text-muted)", background: "transparent", border: "1px solid var(--color-border)" }}
          aria-label="Notifications"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-bg)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </button>

        {/* Divider */}
        <div style={{ width: "1px", height: "24px", background: "var(--color-border)" }} />

        {/* Avatar */}
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold cursor-default select-none"
          style={{
            background: "#C41230",
            color: "#FFFFFF",
            fontFamily: "var(--font-heading)",
            letterSpacing: "0.05em",
          }}
          title={profile?.name ?? ""}
        >
          {getInitials(profile?.name ?? null)}
        </div>
      </div>
    </header>
  );
}
