import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { supplierConfirmationSchema } from "@/lib/services/preorders/schemas";
import { requirePreorderAccess } from "@/lib/services/preorders/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePreorderAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await context.params;
    const json = await request.json();
    const parsed = supplierConfirmationSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("deal_custom_specs")
      .update({
        supplier_confirmed: parsed.data.confirmed,
        supplier_confirmed_by: parsed.data.confirmed ? auth.userId : null,
        supplier_confirmed_at: parsed.data.confirmed ? new Date().toISOString() : null,
      })
      .eq("deal_id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
