import { NextResponse } from "next/server";
import { preOrderCreateSchema } from "@/lib/services/preorders/schemas";
import { createPreorderDeal, requirePreorderAccess } from "@/lib/services/preorders/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requirePreorderAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const json = await request.json();
    const parsed = preOrderCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.source === "PRE_ORDER_CATALOG" && !parsed.data.catalog) {
      return NextResponse.json(
        { error: "Catalog source requires catalog selection" },
        { status: 400 }
      );
    }
    if (parsed.data.source === "PRE_ORDER_CUSTOM" && !parsed.data.custom_spec) {
      return NextResponse.json(
        { error: "Custom source requires custom specification" },
        { status: 400 }
      );
    }

    const result = await createPreorderDeal(parsed.data as unknown as Record<string, unknown>);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
