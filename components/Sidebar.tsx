"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
        .filter(
          (i) =>
            i.href !== "/transfers" &&
            i.href !== "/employees" &&
            i.href !== "/investors"
        )
        .map((i) => i.href)
    );
  }
  return new Set();
}

export default function Sidebar() {
  const router = useRouter();
  const { profile, role } = useAuth();
  const visibleHrefs = visibleHrefsForRole(role);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside className="flex h-full w-64 flex-col bg-[#0a0a0a] text-sm text-zinc-200">
      <div className="px-4 py-6 text-lg font-semibold text-[#c0392b]">
        Axira Trading FZE
      </div>
      <div className="border-b border-[#222222] px-4 pb-3">
        <p className="text-xs text-zinc-400">
          Welcome, {profile?.name?.trim() || "User"}
        </p>
        {role && (
          <span className="mt-1 inline-block rounded border border-[#c0392b]/50 bg-[#c0392b]/10 px-2 py-0.5 text-[11px] font-medium text-[#c0392b]">
            {roleLabel(role)}
          </span>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 pb-4">
        {navItems.map((item) =>
          visibleHrefs.has(item.href) ? (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 font-medium text-zinc-200 transition hover:bg-zinc-900 hover:text-[#c0392b]"
            >
              {item.label}
            </Link>
          ) : null
        )}
        {visibleHrefs.has("/admin/users") && (
          <Link
            href="/admin/users"
            className="rounded-md px-3 py-2 font-medium text-zinc-200 transition hover:bg-zinc-900 hover:text-[#c0392b]"
          >
            Users
          </Link>
        )}
      </nav>
      <div className="border-t border-[#222222] p-2">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-zinc-400 transition hover:bg-zinc-900 hover:text-red-400"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
