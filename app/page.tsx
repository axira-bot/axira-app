"use client";

import { Card, Text } from "@heroui/react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16" style={{ background: "var(--color-bg)" }}>
      <Card.Root className="w-full max-w-lg border border-default-200 shadow-md">
        <Card.Header className="flex flex-col gap-1">
          <Card.Title className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            Axira Trading FZE
          </Card.Title>
          <Card.Description className="text-lg font-medium text-danger">
            Dashboard
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Text className="text-sm text-default-500">
            Use the sidebar to open Dashboard and other modules after you sign in.
          </Text>
        </Card.Content>
      </Card.Root>
    </div>
  );
}
