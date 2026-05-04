"use client";

import { Card, Text } from "@heroui/react";

export default function FXBar() {
  return (
    <Card.Root className="rounded-none border-b border-zinc-800 bg-black">
      <Card.Content className="flex flex-row items-center justify-between px-4 py-2">
        <Text className="text-xs font-semibold text-danger">FX Rates</Text>
        <Text className="text-xs text-zinc-200">USD/AED: 3.6725</Text>
      </Card.Content>
    </Card.Root>
  );
}

