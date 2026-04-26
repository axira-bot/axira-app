"use client";

export default function GlobalLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bg)" }}>
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-transparent"
        style={{ borderTopColor: "#C41230" }}
      />
    </div>
  );
}
