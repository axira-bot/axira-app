"use client";

import { Button } from "@heroui/react";
import { useI18n, type Locale } from "@/lib/context/I18nContext";

const LOCALES: Locale[] = ["en", "fr", "ar"];

/** Compact EN / FR / ع toggle — use in login or anywhere outside the main header. */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className={`flex items-center gap-1 ${className}`} role="group" aria-label={t("nav.language")}>
      {LOCALES.map((l) => (
        <Button
          key={l}
          type="button"
          size="sm"
          variant={locale === l ? "primary" : "ghost"}
          className="min-w-9 h-8 px-2 text-[11px] font-semibold"
          onPress={() => setLocale(l)}
        >
          {l === "ar" ? "ع" : l.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}
