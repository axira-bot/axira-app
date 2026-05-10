"use client";

import { usePathname } from "next/navigation";
import { Button, Separator } from "@heroui/react";
import { useAuth } from "@/lib/context/AuthContext";
import { useI18n } from "@/lib/context/I18nContext";
import { pageMetaKeysForPathname } from "@/lib/i18n/pageMeta";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

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
  const { t } = useI18n();
  const { titleKey, subtitleKey } = pageMetaKeysForPathname(pathname);
  const title = t(titleKey);
  const subtitle = subtitleKey ? t(subtitleKey) : "";

  return (
    <header
      className="sticky top-0 z-20 hidden h-16 shrink-0 items-center justify-between px-4 lg:px-6 md:flex"
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
        <LocaleSwitcher />

        <Button
          type="button"
          variant="ghost"
          isIconOnly
          size="sm"
          aria-label={t("appShell.notifications")}
          className="text-default-500 hover:text-danger"
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
