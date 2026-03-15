"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/context/AuthContext";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/activity": "Activity",
  "/inventory": "Inventory",
  "/deals": "Deals",
  "/containers": "Containers",
  "/movements": "Movements",
  "/transfers": "Transfers",
  "/debts": "Debts",
  "/employees": "Employees",
  "/investors": "Investors",
  "/reports": "Reports",
  "/clients": "Clients",
  "/admin/users": "Users",
  "/login": "Login",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const segment = pathname.split("/")[1];
  if (segment && PAGE_TITLES[`/${segment}`]) return PAGE_TITLES[`/${segment}`];
  return "Axira Trading FZE";
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

  return (
    <header
      className="hidden md:flex h-16 shrink-0 items-center justify-between px-6"
      style={{
        background: "var(--color-bg)",
        borderBottom: "1px solid rgba(201,168,76,0.2)",
      }}
    >
      <h1
        className="text-xl font-semibold"
        style={{ fontFamily: "var(--font-heading)", color: "var(--color-text)" }}
      >
        {title}
      </h1>

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded-full p-2 transition hover:bg-white/5"
          aria-label="Notifications"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full font-semibold"
          style={{
            background: "var(--color-accent)",
            color: "var(--color-bg)",
            fontFamily: "var(--font-heading)",
            fontSize: "0.75rem",
          }}
        >
          {getInitials(profile?.name ?? null)}
        </div>
      </div>
    </header>
  );
}
