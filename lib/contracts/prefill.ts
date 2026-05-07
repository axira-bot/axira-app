import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentMode, ModalFormValues, PrefillMeta } from "@/lib/contracts/modalFields";
import { DEFAULT_MODAL_VALUES } from "@/lib/contracts/modalFields";

type PrefillInput = { admin: SupabaseClient; dealId: string; mode: DocumentMode; paymentId?: string };

export async function loadPrefillData({ admin, dealId, mode, paymentId }: PrefillInput): Promise<{ values: ModalFormValues; meta: PrefillMeta }> {
  const { data: deal, error: dealErr } = await admin.from("deals").select("*").eq("id", dealId).single();
  if (dealErr || !deal) throw new Error(dealErr?.message || "Deal not found");

  const [{ data: client }, { data: car }, { data: customSpec }, paymentResp] = await Promise.all([
    deal.client_id ? admin.from("clients").select("*").eq("id", deal.client_id).maybeSingle() : Promise.resolve({ data: null }),
    deal.car_id ? admin.from("cars").select("*").eq("id", deal.car_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("deal_custom_specs").select("*").eq("deal_id", dealId).maybeSingle(),
    mode === "receipt" && paymentId
      ? admin.from("payments").select("*").eq("id", paymentId).eq("deal_id", dealId).single()
      : Promise.resolve({ data: null }),
  ]);

  const values: ModalFormValues = {
    ...DEFAULT_MODAL_VALUES,
    client_full_name: String(client?.name ?? deal.client_name ?? ""),
    client_id_number: String(client?.passport_number ?? ""),
    client_phone: String(client?.phone ?? ""),
    client_email: String(client?.email ?? ""),
    client_address: String(client?.algeria_address ?? ""),
    vehicle_brand: String(car?.brand ?? customSpec?.brand ?? ""),
    vehicle_model: String(car?.model ?? customSpec?.model ?? ""),
    vehicle_year: car?.year != null ? String(car.year) : customSpec?.year != null ? String(customSpec.year) : "",
    vehicle_trim: String(car?.grade ?? customSpec?.trim ?? ""),
    vehicle_exterior_color: String(car?.color ?? customSpec?.color ?? ""),
    vehicle_interior_color: String(car?.interior_color ?? ""),
    vehicle_mileage: car?.mileage != null ? String(car.mileage) : "",
    vehicle_vin: String(car?.vin ?? ""),
    vehicle_engine: String(car?.engine ?? ""),
    vehicle_transmission: String(car?.transmission ?? ""),
    vehicle_fuel: String(car?.fuel_type ?? ""),
    vehicle_origin: String(car?.country_of_origin ?? ""),
    vehicle_condition: String(car?.condition || "Brand New"),
    vehicle_options: Array.isArray(car?.features) ? car.features.join(", ") : String(customSpec?.options ?? ""),
    vehicle_disclosures: String(car?.body_issues ?? deal.notes ?? ""),
    total_price_dzd: deal.sale_amount != null ? String(deal.sale_amount) : "",
    deposit_amount_dzd: car?.sales_deposit_dzd != null ? String(car.sales_deposit_dzd) : "",
    balance_amount_dzd:
      deal.sale_amount != null && car?.sales_deposit_dzd != null
        ? String(Math.max(Number(deal.sale_amount) - Number(car.sales_deposit_dzd), 0))
        : deal.pending_dzd != null
          ? String(deal.pending_dzd)
          : "",
    lead_time_days: car?.sales_lead_time_days != null ? String(car.sales_lead_time_days) : "",
    payment_type:
      Number(deal.pending_dzd || 0) > 0 || Number(car?.sales_deposit_dzd || 0) > 0
        ? "Deposit"
        : "Full",
    amount_dzd:
      paymentResp.data?.amount != null
        ? String(paymentResp.data.amount)
        : paymentResp.data?.dzd != null
          ? String(paymentResp.data.dzd)
          : "",
    exchange_rate:
      paymentResp.data?.rate_snapshot != null
        ? String(paymentResp.data.rate_snapshot)
        : paymentResp.data?.rate_to_aed != null
          ? String(paymentResp.data.rate_to_aed)
          : paymentResp.data?.rate != null
            ? String(paymentResp.data.rate)
            : "",
  };

  const meta: PrefillMeta = {
    dealSource: String(deal.source || "").toUpperCase() || null,
    hasCarId: Boolean(deal.car_id),
  };
  return { values, meta };
}
