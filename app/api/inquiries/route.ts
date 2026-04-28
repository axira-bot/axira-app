import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type CreateInquiryBody = {
  name?: string;
  phone?: string;
  message?: string | null;
  car_label?: string | null;
  whatsapp_ref?: string | null;
  assigned_employee_id?: string | null;
};

type AssignInquiryBody = {
  id?: string;
  assigned_employee_id?: string | null;
};

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as CreateInquiryBody;
    if (!body.name?.trim() || !body.phone?.trim()) {
      return NextResponse.json({ error: "Name and phone are required." }, { status: 400 });
    }

    const admin = createAdminClient();
    const basePayload = {
      name: body.name.trim(),
      phone: body.phone.trim(),
      message: body.message?.trim() || null,
      car_label: body.car_label?.trim() || null,
      status: "new",
      source: "whatsapp",
      notes: body.whatsapp_ref?.trim() ? `WA_REF:${body.whatsapp_ref.trim()}` : null,
    };
    const extendedPayload = {
      ...basePayload,
      source_channel: "whatsapp",
      whatsapp_ref: body.whatsapp_ref?.trim() || null,
      assigned_employee_id: body.assigned_employee_id || null,
    };

    const first = await admin.from("inquiries").insert(extendedPayload).select("*").single();
    if (!first.error) return NextResponse.json({ row: first.data }, { status: 201 });

    const fallback = await admin.from("inquiries").insert(basePayload).select("*").single();
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    return NextResponse.json({ row: fallback.data }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as AssignInquiryBody;
    if (!body.id) {
      return NextResponse.json({ error: "Inquiry id is required." }, { status: 400 });
    }
    const admin = createAdminClient();
    const first = await admin
      .from("inquiries")
      .update({ assigned_employee_id: body.assigned_employee_id || null })
      .eq("id", body.id);
    if (!first.error) return NextResponse.json({ ok: true });

    const { data: current, error: currentErr } = await admin
      .from("inquiries")
      .select("notes")
      .eq("id", body.id)
      .maybeSingle();
    if (currentErr) return NextResponse.json({ error: first.error.message }, { status: 500 });

    const existingNotes = (current as { notes?: string | null } | null)?.notes || "";
    const cleaned = existingNotes.replace(/ASSIGNED_EMPLOYEE_ID:[^\s]+/g, "").trim();
    const marker = body.assigned_employee_id
      ? `ASSIGNED_EMPLOYEE_ID:${body.assigned_employee_id}`
      : "";
    const mergedNotes = [cleaned, marker].filter(Boolean).join(" ").trim() || null;
    const fallback = await admin.from("inquiries").update({ notes: mergedNotes }).eq("id", body.id);
    if (fallback.error) return NextResponse.json({ error: first.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, fallback: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
