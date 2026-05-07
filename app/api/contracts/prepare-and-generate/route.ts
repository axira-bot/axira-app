import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContractGenerationAccess } from "@/lib/contracts/auth";
import { buildValidationSchema, type ModalFormValues, type PrefillMeta } from "@/lib/contracts/modalFields";
import { finalizeGeneratedDocument } from "@/lib/contracts/finalize";

type Payload = {
  mode?: "agreement" | "receipt";
  deal_id?: string;
  payment_id?: string;
  values?: Partial<ModalFormValues>;
  meta?: PrefillMeta;
};

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireContractGenerationAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as Payload;
    const mode = body.mode === "receipt" ? "receipt" : "agreement";
    const dealId = String(body.deal_id || "").trim();
    const paymentId = String(body.payment_id || "").trim();
    if (!dealId) return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    if (mode === "receipt" && !paymentId) {
      return NextResponse.json({ error: "payment_id is required for receipt" }, { status: 400 });
    }

    const meta: PrefillMeta = {
      dealSource: body.meta?.dealSource ?? null,
      hasCarId: Boolean(body.meta?.hasCarId),
    };
    const schema = buildValidationSchema(mode, meta);
    const parsed = schema.safeParse(body.values || {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", field_errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const v = parsed.data as ModalFormValues;
    const admin = createAdminClient();
    const updateRpc = await admin.rpc("save_contract_pregen_data", {
      p_deal_id: dealId,
      p_payment_id: mode === "receipt" ? paymentId : null,
      p_mode: mode,
      p_payload: {
        client_full_name: v.client_full_name,
        client_id_number: v.client_id_number,
        client_phone: v.client_phone,
        client_email: v.client_email,
        client_address: v.client_address,
        vehicle_brand: v.vehicle_brand,
        vehicle_model: v.vehicle_model,
        vehicle_year: v.vehicle_year ? Number(v.vehicle_year) : null,
        vehicle_trim: v.vehicle_trim,
        vehicle_exterior_color: v.vehicle_exterior_color,
        vehicle_interior_color: v.vehicle_interior_color,
        vehicle_mileage: v.vehicle_mileage ? Number(v.vehicle_mileage) : null,
        vehicle_vin: v.vehicle_vin,
        vehicle_engine: v.vehicle_engine,
        vehicle_transmission: v.vehicle_transmission,
        vehicle_fuel: v.vehicle_fuel,
        vehicle_origin: v.vehicle_origin,
        vehicle_condition: v.vehicle_condition,
        vehicle_options: v.vehicle_options,
        vehicle_disclosures: v.vehicle_disclosures,
        total_price_dzd: v.total_price_dzd ? Number(v.total_price_dzd) : null,
        deposit_amount_dzd: v.deposit_amount_dzd ? Number(v.deposit_amount_dzd) : null,
        balance_amount_dzd: v.balance_amount_dzd ? Number(v.balance_amount_dzd) : null,
        lead_time_days: v.lead_time_days ? Number(v.lead_time_days) : null,
        payment_type: v.payment_type,
        amount_dzd: v.amount_dzd ? Number(v.amount_dzd) : null,
        exchange_rate: v.exchange_rate ? Number(v.exchange_rate) : null,
      },
    });
    if (updateRpc.error) return NextResponse.json({ error: updateRpc.error.message }, { status: 400 });

    const finalized = await finalizeGeneratedDocument({
      admin,
      user: auth.user,
      mode,
      dealId,
      paymentId: mode === "receipt" ? paymentId : undefined,
    });

    return new NextResponse(new Uint8Array(finalized.generated.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${finalized.generated.fileName}"`,
        "x-generated-document-id": finalized.generatedDocumentId,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
