/** Resolves pathname to messages keys under `pages.*` for header / shell. */

export type PageMetaKeys = { titleKey: string; subtitleKey: string };

export function pageMetaKeysForPathname(pathname: string): PageMetaKeys {
  if (pathname === "/" || pathname === "") {
    return { titleKey: "pages.root.title", subtitleKey: "pages.root.subtitle" };
  }
  if (pathname === "/login") {
    return { titleKey: "pages.login.title", subtitleKey: "pages.login.subtitle" };
  }
  if (pathname.startsWith("/admin/users")) {
    return { titleKey: "pages.adminUsers.title", subtitleKey: "pages.adminUsers.subtitle" };
  }
  if (pathname.startsWith("/settings/company")) {
    return { titleKey: "pages.settingsCompany.title", subtitleKey: "pages.settingsCompany.subtitle" };
  }
  if (pathname.startsWith("/purchase-orders/") && pathname !== "/purchase-orders") {
    return {
      titleKey: "pages.purchaseOrdersDetail.title",
      subtitleKey: "pages.purchaseOrdersDetail.subtitle",
    };
  }

  const map: Record<string, PageMetaKeys> = {
    "/dashboard": { titleKey: "pages.dashboard.title", subtitleKey: "pages.dashboard.subtitle" },
    "/audit": { titleKey: "pages.audit.title", subtitleKey: "pages.audit.subtitle" },
    "/activity": { titleKey: "pages.activity.title", subtitleKey: "pages.activity.subtitle" },
    "/inventory": { titleKey: "pages.inventory.title", subtitleKey: "pages.inventory.subtitle" },
    "/deals": { titleKey: "pages.deals.title", subtitleKey: "pages.deals.subtitle" },
    "/sales-list": { titleKey: "pages.salesList.title", subtitleKey: "pages.salesList.subtitle" },
    "/catalog": { titleKey: "pages.catalog.title", subtitleKey: "pages.catalog.subtitle" },
    "/containers": { titleKey: "pages.containers.title", subtitleKey: "pages.containers.subtitle" },
    "/movements": { titleKey: "pages.movements.title", subtitleKey: "pages.movements.subtitle" },
    "/transfers": { titleKey: "pages.transfers.title", subtitleKey: "pages.transfers.subtitle" },
    "/debts": { titleKey: "pages.debts.title", subtitleKey: "pages.debts.subtitle" },
    "/employees": { titleKey: "pages.employees.title", subtitleKey: "pages.employees.subtitle" },
    "/payroll": { titleKey: "pages.payroll.title", subtitleKey: "pages.payroll.subtitle" },
    "/investors": { titleKey: "pages.investors.title", subtitleKey: "pages.investors.subtitle" },
    "/reports": { titleKey: "pages.reports.title", subtitleKey: "pages.reports.subtitle" },
    "/clients": { titleKey: "pages.clients.title", subtitleKey: "pages.clients.subtitle" },
    "/inquiries": { titleKey: "pages.inquiries.title", subtitleKey: "pages.inquiries.subtitle" },
    "/suppliers": { titleKey: "pages.suppliers.title", subtitleKey: "pages.suppliers.subtitle" },
    "/purchase-orders": { titleKey: "pages.purchaseOrders.title", subtitleKey: "pages.purchaseOrders.subtitle" },
    "/users": { titleKey: "pages.users.title", subtitleKey: "pages.users.subtitle" },
  };

  if (map[pathname]) return map[pathname];
  return { titleKey: "pages.fallback.title", subtitleKey: "pages.fallback.subtitle" };
}
