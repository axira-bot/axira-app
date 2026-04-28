import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type EditRequestBody = {
  request_type?: "sale_change" | "car_change" | "client_change" | "cancel_request";
  requested_payload?: Record<string, unknown>;
  reason?: string | null;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const body = (await request.json()) as EditRequestBody;
    if (!body.request_type) {
      return NextResponse.json({ error: "request_type is required" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { error } = await admin.from("deal_edit_requests").insert({
      deal_id: id,
      requested_by: user.id,
      request_type: body.request_type,
      requested_payload: body.requested_payload || {},
      reason: body.reason || null,
      status: "pending",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
