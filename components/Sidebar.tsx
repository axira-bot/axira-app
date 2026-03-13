import Link from "next/link";

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

export default function Sidebar() {
  return (
    <aside className="flex h-full w-64 flex-col bg-[#0a0a0a] text-sm text-zinc-200">
      <div className="px-4 py-6 text-lg font-semibold text-[#c0392b]">
        Axira Trading FZE
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 pb-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 font-medium text-zinc-200 transition hover:bg-zinc-900 hover:text-[#c0392b]"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

