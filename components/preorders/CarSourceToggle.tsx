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
        <button
          type="button"
          onClick={() => onChange("PRE_ORDER_CATALOG")}
          className={[
            "rounded-full border px-3 py-1 text-xs font-semibold transition",
            source === "PRE_ORDER_CATALOG"
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
              : "border-app text-app",
          ].join(" ")}
        >
          From catalog
        </button>
        <button
          type="button"
          onClick={() => onChange("PRE_ORDER_CUSTOM")}
          className={[
            "rounded-full border px-3 py-1 text-xs font-semibold transition",
            source === "PRE_ORDER_CUSTOM"
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
              : "border-app text-app",
          ].join(" ")}
        >
          Custom request
        </button>
      </div>
    </div>
  );
}
