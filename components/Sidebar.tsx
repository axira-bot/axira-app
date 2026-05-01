"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { type FeatureKey } from "@/lib/auth/featureKeys";

/* ── Nav Icons ─────────────────────────────────────────────── */
const icons: Record<string, React.ReactNode> = {
  "/dashboard": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  "/activity": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  "/inventory": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
      <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  ),
  "/deals": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  ),
  "/containers": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  ),
  "/movements": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/>
    </svg>
  ),
  "/transfers": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  ),
  "/debts": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  "/employees": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  "/payroll": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="12" y1="16" x2="16" y2="16"/>
    </svg>
  ),
  "/investors": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  "/reports": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  "/clients": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  "/inquiries": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  "/purchase-orders": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  ),
  "/suppliers": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v0"/><path d="M9 12v0"/><path d="M9 15v0"/><path d="M9 18v0"/>
    </svg>
  ),
  "/admin/users": (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
    </svg>
  ),
};

/* ── Nav Items ─────────────────────────────────────────────── */
const navItems = [
  { href: "/dashboard",   label: "Dashboard" },
  { href: "/activity",    label: "Activity" },
  { href: "/inventory",   label: "Inventory" },
  { href: "/deals",       label: "Deals" },
  { href: "/containers",  label: "Containers" },
  { href: "/movements",   label: "Movements" },
  { href: "/transfers",   label: "Transfers" },
  { href: "/debts",       label: "Debts" },
  { href: "/employees",   label: "Employees" },
  { href: "/payroll",     label: "Payroll" },
  { href: "/investors",   label: "Investors" },
  { href: "/reports",     label: "Reports" },
  { href: "/clients",     label: "Clients" },
  { href: "/inquiries",   label: "Inquiries" },
  { href: "/suppliers",   label: "Suppliers" },
  { href: "/purchase-orders", label: "Purchase Orders" },
];

/* Groups with subtle dividers */
const groups = [
  ["/dashboard", "/activity"],
  ["/inventory", "/deals", "/containers", "/movements", "/transfers", "/debts"],
  ["/employees", "/payroll", "/investors", "/reports", "/clients", "/inquiries", "/suppliers", "/purchase-orders"],
];

function roleLabel(role: string | null): string {
  if (!role) return "";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

const ROUTE_FEATURE_MAP: Record<string, FeatureKey> = {
  "/dashboard": "dashboard",
  "/activity": "activity",
  "/inventory": "inventory",
  "/deals": "deals",
  "/containers": "containers",
  "/movements": "movements",
  "/transfers": "transfers",
  "/debts": "debts",
  "/employees": "employees",
  "/payroll": "payroll",
  "/investors": "investors",
  "/reports": "reports",
  "/clients": "clients",
  "/inquiries": "inquiries",
  "/suppliers": "suppliers",
  "/purchase-orders": "purchase_orders",
  "/admin/users": "admin_users",
};

function visibleHrefsForPermissions(
  role: string | null,
  permissions: Partial<Record<FeatureKey, boolean>>
): Set<string> {
  if (!role) return new Set<string>();
  if (role === "owner") return new Set(Object.keys(ROUTE_FEATURE_MAP));
  return new Set(
    Object.entries(ROUTE_FEATURE_MAP)
      .filter(([, key]) => Boolean(permissions[key]))
      .map(([href]) => href)
  );
}

/* ── Logo ──────────────────────────────────────────────────── */
function AxiraLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 40 40" className="shrink-0">
      <polygon points="20,2 38,36 2,36" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <polygon points="20,10 32,34 8,34" fill="rgba(255,255,255,0.06)" />
      <polygon points="20,18 28,32 12,32" fill="#C41230" />
    </svg>
  );
}

/* ── Mobile Hamburger Button ───────────────────────────────── */
export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center w-9 h-9 rounded-lg md:hidden"
      style={{ color: "rgba(255,255,255,0.8)", background: "rgba(255,255,255,0.08)" }}
      aria-label="Open menu"
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="2" y1="5" x2="16" y2="5" />
        <line x1="2" y1="10" x2="16" y2="10" />
        <line x1="2" y1="15" x2="16" y2="15" />
      </svg>
    </button>
  );
}

/* ── Sidebar Content ───────────────────────────────────────── */
function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, role, permissions } = useAuth();
  const visibleHrefs = visibleHrefsForPermissions(role, permissions);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const renderNavItem = (href: string, label: string) => {
    if (!visibleHrefs.has(href)) return null;
    const isActive = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        prefetch
        onClick={onClose}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150"
        style={{
          color: isActive ? "#FFFFFF" : "rgba(170,170,170,0.85)",
          background: isActive ? "rgba(196,18,48,0.18)" : "transparent",
          borderLeft: isActive ? "3px solid #C41230" : "3px solid transparent",
          paddingLeft: "0.625rem",
        }}
        onMouseEnter={(e) => {
          router.prefetch(href);
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
            (e.currentTarget as HTMLElement).style.color = "#FFFFFF";
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "rgba(170,170,170,0.85)";
          }
        }}
      >
        <span style={{ color: isActive ? "#C41230" : "rgba(170,170,170,0.6)", flexShrink: 0 }}>
          {icons[href]}
        </span>
        <span style={{ fontFamily: "var(--font-body)", letterSpacing: "0.01em" }}>{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--color-sidebar)" }}>
      {/* Logo */}
      <div className="flex items-center justify-between px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <AxiraLogo />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-[0.15em]" style={{ fontFamily: "var(--font-brand)", color: "#FFFFFF" }}>
              AXIRA
            </span>
            <span className="text-[9px] tracking-[0.25em] uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
              Auto Export
            </span>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg transition"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.4)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 mb-3" style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group, gi) => {
          const items = group
            .map((href) => {
              const item = navItems.find((n) => n.href === href);
              if (!item) return null;
              return renderNavItem(item.href, item.label);
            })
            .filter(Boolean);

          if (items.length === 0) return null;

          return (
            <div key={gi}>
              {gi > 0 && (
                <div className="mx-2 my-3" style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />
              )}
              <div className="flex flex-col gap-0.5">{items}</div>
            </div>
          );
        })}

        {/* Admin users */}
        {visibleHrefs.has("/admin/users") && (
          <>
            <div className="mx-2 my-3" style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />
            <div className="flex flex-col gap-0.5">
              {renderNavItem("/admin/users", "Users")}
            </div>
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{ background: "#C41230", color: "#fff", fontFamily: "var(--font-body)" }}
          >
            {profile?.name?.trim()?.slice(0, 1).toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium" style={{ color: "#FFFFFF" }}>
              {profile?.name?.trim() || "User"}
            </p>
            {role && (
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                {roleLabel(role)}
              </p>
            )}
          </div>
          {/* Logout */}
          <button
            type="button"
            onClick={handleLogout}
            title="Log out"
            className="p-1.5 rounded-lg transition"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#C41230"; (e.currentTarget as HTMLElement).style.background = "rgba(196,18,48,0.12)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.4)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Desktop Sidebar ───────────────────────────────────────── */
export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-30 hidden md:flex h-full w-[240px] flex-col">
      <SidebarContent />
    </aside>
  );
}

/* ── Mobile Drawer ─────────────────────────────────────────── */
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
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <aside className="absolute left-0 top-0 h-full w-[280px] flex flex-col">
        <SidebarContent onClose={onClose} />
      </aside>
    </div>
  );
}
