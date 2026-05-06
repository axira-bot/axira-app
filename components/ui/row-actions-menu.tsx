"use client";

import { Button, Popover } from "@heroui/react";
import type { ReactNode } from "react";
import { useState } from "react";

type RowActionsMenuProps = {
  label?: string;
  children: ReactNode;
};

export function RowActionsMenu({ label = "Open actions menu", children }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
    >
      <Popover.Trigger>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label={label}
          className="text-default-500"
        >
          <span className="text-base leading-none">⋮</span>
        </Button>
      </Popover.Trigger>
      <Popover.Content
        placement="bottom end"
        offset={6}
        className="
          z-[10000] min-w-[170px] overflow-hidden rounded-lg border border-default-200 bg-content1 py-1 shadow-xl
          [&_button]:m-0 [&_button]:w-full [&_button]:justify-start [&_button]:rounded-none [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:text-left
          [&_button]:text-xs [&_button]:font-medium [&_button]:text-default-700 [&_button]:shadow-none [&_button]:min-h-0 [&_button:hover]:bg-default-100
          [&_a]:m-0 [&_a]:block [&_a]:w-full [&_a]:rounded-none [&_a]:border-0 [&_a]:bg-transparent [&_a]:px-3 [&_a]:py-2 [&_a]:text-left [&_a]:text-xs [&_a]:font-medium
          [&_a]:text-default-700 [&_a:hover]:bg-default-100
        "
      >
        <Popover.Dialog
          className="outline-none"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("button,a")) setOpen(false);
          }}
        >
          {children}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
