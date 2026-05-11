"use client";

import { Card, Text } from "@heroui/react";
import { useI18n } from "@/lib/context/I18nContext";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default function Home() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center px-6 py-16" style={{ background: "var(--color-bg)" }}>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
      <Card.Root className="w-full max-w-lg border border-default-200 shadow-md">
        <Card.Header className="flex flex-col gap-1">
          <Card.Title className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {t("home.title")}
          </Card.Title>
          <Card.Description className="text-lg font-medium text-danger">
            {t("home.dashboard")}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Text className="text-sm text-default-500">
            {t("home.blurb")}
          </Text>
        </Card.Content>
      </Card.Root>
    </div>
  );
}
