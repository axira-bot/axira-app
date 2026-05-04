"use client";

import { Button } from "@heroui/react";
import type { PreorderSource } from "./types";

export default function CarSourceToggle({
  source,
  onChange,
}: {
  source: PreorderSource;
  onChange: (source: PreorderSource) => void;
}) {
  return (
    <div className="rounded-md border border-app bg-white p-3 text-xs text-app">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Car source
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={source === "PRE_ORDER_CATALOG" ? "primary" : "outline"}
          onPress={() => onChange("PRE_ORDER_CATALOG")}
        >
          From catalog
        </Button>
        <Button
          type="button"
          size="sm"
          variant={source === "PRE_ORDER_CUSTOM" ? "primary" : "outline"}
          onPress={() => onChange("PRE_ORDER_CUSTOM")}
        >
          Custom request
        </Button>
      </div>
    </div>
  );
}
