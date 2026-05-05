"use client";

import { usePathname } from "next/navigation";
import { Button, Separator } from "@heroui/react";
import { useAuth } from "@/lib/context/AuthContext";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":   "Dashboard",
  "/audit":       "Audit log",
  "/activity":    "Activity",
  "/inventory":   "Inventory",
  "/deals":       "Deals",
  "/sales-list":  "Sales list",
  "/catalog":     "Sales catalog",
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
  "/sales-list":  "Algeria pricing & lead times",
  "/catalog":     "Order-on-demand retail SKUs",
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
      <div className="flex flex-col">
        <h1
          className="text-lg font-semibold leading-tight"
          style={{ color: "var(--color-text)", fontFamily: "var(--font-heading)" }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="text-xs leading-tight mt-0.5 text-default-500">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          isIconOnly
          size="sm"
          aria-label="Notifications"
          className="text-default-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </Button>

        <Separator orientation="vertical" className="h-6" />

        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold cursor-default select-none bg-danger text-danger-foreground"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "0.05em" }}
          title={profile?.name ?? ""}
        >
          {getInitials(profile?.name ?? null)}
        </div>
      </div>
    </header>
  );
}
