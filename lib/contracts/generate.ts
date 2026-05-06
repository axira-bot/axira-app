import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { SupabaseClient } from "@supabase/supabase-js";

type TemplateType = "agreement" | "receipt";

type GenerateInput = {
  admin: SupabaseClient;
  dealId: string;
  paymentId?: string;
};

type LoadedData = {
  deal: Record<string, unknown>;
  client: Record<string, unknown> | null;
  car: Record<string, unknown> | null;
  customSpec: Record<string, unknown> | null;
  payment: Record<string, unknown> | null;
};

function pickTemplatePath(type: TemplateType) {
  return type === "agreement"
    ? "templates/contracts/sales_brokerage_agreement.docx"
    : "templates/contracts/payment_receipt.docx";
}

function formatDzd(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value || 0))} DZD`;
}

function formatUsd(value: number) {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} USD`;
}

function tinyFr(n: number): string {
  const u = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"];
  if (n < 10) return u[n];
  if (n < 20) return ["dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"][n - 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    const tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
    if (t <= 6) return r ? `${tens[t]}-${tinyFr(r)}` : tens[t];
    if (t === 7) return r ? `soixante-${tinyFr(10 + r)}` : "soixante-dix";
    if (t === 8) return r ? `quatre-vingt-${tinyFr(r)}` : "quatre-vingts";
    return r ? `quatre-vingt-${tinyFr(10 + r)}` : "quatre-vingt-dix";
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const head = h === 1 ? "cent" : `${tinyFr(h)} cent`;
    return r ? `${head} ${tinyFr(r)}` : head;
  }
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const head = th === 1 ? "mille" : `${tinyFr(th)} mille`;
    return r ? `${head} ${tinyFr(r)}` : head;
  }
  if (n < 100_000_000) {
    const m = Math.floor(n / 1_000_000);
    const r = n % 1_000_000;
    const head = m === 1 ? "un million" : `${tinyFr(m)} millions`;
    return r ? `${head} ${tinyFr(r)}` : head;
  }
  return String(n);
}

function tinyAr(n: number): string {
  const u = ["صفر", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
  if (n < 10) return u[n];
  if (n < 20) return ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"][n - 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    const tens = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
    return r ? `${u[r]} و${tens[t]}` : tens[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const hs = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
    return r ? `${hs[h]} و${tinyAr(r)}` : hs[h];
  }
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const head = th === 1 ? "ألف" : th === 2 ? "ألفان" : `${tinyAr(th)} ألف`;
    return r ? `${head} و${tinyAr(r)}` : head;
  }
  if (n < 100_000_000) {
    const m = Math.floor(n / 1_000_000);
    const r = n % 1_000_000;
    const head = m === 1 ? "مليون" : m === 2 ? "مليونان" : `${tinyAr(m)} مليون`;
    return r ? `${head} و${tinyAr(r)}` : head;
  }
  return String(n);
}

function wordsFrDzd(n: number) {
  return `${tinyFr(Math.max(0, Math.round(n)))} dinars algériens`;
}
function wordsArDzd(n: number) {
  return `${tinyAr(Math.max(0, Math.round(n)))} دينار جزائري`;
}

function toPaddedDealRef(dealId: string) {
  const cleaned = (dealId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `AX-CON-${cleaned.slice(0, 10).padStart(10, "0")}`;
}

function nullable(value: unknown, fallback: string) {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s.length ? s : fallback;
}

function pickString(row: Record<string, unknown> | null | undefined, key: string, fallback = "") {
  if (!row) return fallback;
  const v = row[key];
  if (v == null) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function pickNumber(row: Record<string, unknown> | null | undefined, key: string, fallback = 0) {
  if (!row) return fallback;
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : fallback;
}

async function loadData({ admin, dealId, paymentId }: GenerateInput): Promise<LoadedData> {
  const { data: deal, error: dealErr } = await admin.from("deals").select("*").eq("id", dealId).single();
  if (dealErr || !deal) throw new Error(dealErr?.message || "Deal not found");

  const [{ data: client }, { data: car }, { data: customSpec }, paymentResult] = await Promise.all([
    deal.client_id ? admin.from("clients").select("*").eq("id", deal.client_id).maybeSingle() : Promise.resolve({ data: null }),
    deal.car_id ? admin.from("cars").select("*").eq("id", deal.car_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("deal_custom_specs").select("*").eq("deal_id", dealId).maybeSingle(),
    paymentId
      ? admin.from("payments").select("*").eq("id", paymentId).eq("deal_id", dealId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { deal, client, car, customSpec, payment: paymentResult.data };
}

function buildContext(type: TemplateType, loaded: LoadedData) {
  const { deal, client, car, customSpec, payment } = loaded;
  const saleAmount = pickNumber(deal, "sale_amount", 0);
  const totalPaid = pickNumber(deal, "collected_dzd", 0);
  const pending = pickNumber(deal, "pending_dzd", Math.max(saleAmount - totalPaid, 0));
  const hasOutstanding = pending > 0;
  const depositStyle = pickNumber(car, "sales_deposit_dzd", 0) > 0 || hasOutstanding;
  let isFull = totalPaid >= saleAmount && !depositStyle;
  let isDeposit = hasOutstanding || depositStyle;
  if (isFull === isDeposit) {
    isFull = true;
    isDeposit = false;
  }

  const condition = pickString(car, "condition").toLowerCase();
  const isBrandNew = /new|neuf|0\s*km/.test(condition);
  const isUsed = !isBrandNew;
  const fallbackFr = "À confirmer";
  const fallbackAr = "قيد التحديد";
  const fallbackTbc = "TBC";

  const carFeatures = Array.isArray(car?.features) ? (car.features as unknown[]).map((x) => String(x)) : [];
  const vehicleBrand = nullable(car?.brand ?? customSpec?.brand, fallbackFr);
  const vehicleModel = nullable(car?.model ?? customSpec?.model, fallbackFr);
  const vehicleYear = nullable(car?.year ?? customSpec?.year, fallbackFr);
  const vehicleColor = nullable(car?.color ?? customSpec?.color, fallbackFr);
  const vehicleTrim = nullable(car?.grade ?? customSpec?.trim, fallbackFr);
  const vehicleOptions = nullable((carFeatures.length ? carFeatures.join(", ") : customSpec?.options), fallbackFr);
  const vin = nullable(car?.vin, fallbackTbc);

  const amountDzd = Number((payment?.amount as number | null | undefined) ?? (payment?.dzd as number | null | undefined) ?? 0);
  const fxRate = Number((payment?.rate_snapshot as number | null | undefined) ?? (payment?.rate_to_aed as number | null | undefined) ?? (payment?.rate as number | null | undefined) ?? 0);
  const amountUsd = fxRate > 0 ? amountDzd / fxRate : 0;

  const seq = Number(payment?.id ? 1 : 1);
  const receiptReference = `AX-RCP-${String(deal.id).slice(0, 8)}-${seq}`;

  return {
    fze_license_number: nullable(process.env.AXIRA_FZE_LICENSE_NUMBER, fallbackTbc),
    fze_address: nullable(process.env.AXIRA_FZE_ADDRESS, fallbackFr),
    auto_license_number: nullable(process.env.AXIRA_AUTO_LICENSE_NUMBER, fallbackTbc),
    auto_address: nullable(process.env.AXIRA_AUTO_ADDRESS, fallbackFr),
    contract_reference: toPaddedDealRef(String(deal.id)),
    contract_date: nullable(deal.date, new Date().toISOString().slice(0, 10)),
    receipt_reference: receiptReference,
    receipt_date: nullable(payment?.date, new Date().toISOString().slice(0, 10)),
    fze_representative: nullable(process.env.AXIRA_FZE_REPRESENTATIVE, fallbackFr),
    fze_position: nullable(process.env.AXIRA_FZE_POSITION, fallbackFr),
    auto_representative: nullable(process.env.AXIRA_AUTO_REPRESENTATIVE, fallbackFr),
    auto_position: nullable(process.env.AXIRA_AUTO_POSITION, fallbackFr),
    client_full_name: nullable(client?.name ?? deal.client_name, fallbackFr),
    client_id_number: nullable(client?.passport_number, fallbackTbc),
    client_id_issue_date: nullable(client?.created_at, fallbackFr),
    client_id_issue_place: fallbackFr,
    client_address: nullable(client?.algeria_address, fallbackFr),
    client_phone: nullable(client?.phone, fallbackTbc),
    client_email: nullable(client?.email, fallbackFr),
    vehicle_brand: vehicleBrand,
    vehicle_model: vehicleModel,
    vehicle_year: vehicleYear,
    vehicle_trim: vehicleTrim,
    vehicle_exterior_color: vehicleColor,
    vehicle_interior_color: fallbackFr,
    vehicle_mileage: nullable(car?.mileage, fallbackFr),
    vehicle_vin: vin,
    vehicle_engine: nullable(car?.engine, fallbackFr),
    vehicle_transmission: nullable(car?.transmission, fallbackFr),
    vehicle_fuel: nullable(car?.fuel_type, fallbackFr),
    vehicle_origin: nullable(car?.country_of_origin, fallbackFr),
    vehicle_condition: nullable(car?.condition, fallbackFr),
    vehicle_options: vehicleOptions,
    vehicle_disclosures: nullable(car?.body_issues ?? deal.notes, fallbackFr),
    total_price_dzd: formatDzd(saleAmount),
    total_price_words: wordsFrDzd(saleAmount),
    deposit_amount_dzd: formatDzd(Number(car?.sales_deposit_dzd || 0)),
    balance_amount_dzd: formatDzd(Math.max(saleAmount - Number(car?.sales_deposit_dzd || 0), 0)),
    lead_time_days: String(pickNumber(car, "sales_lead_time_days", 0)),
    amount_dzd: formatDzd(amountDzd),
    amount_words: type === "receipt" ? `${wordsFrDzd(amountDzd)} / ${wordsArDzd(amountDzd)}` : wordsFrDzd(saleAmount),
    amount_usd: formatUsd(amountUsd),
    exchange_rate: fxRate > 0 ? String(fxRate) : "0",
    payment_type: isDeposit ? "Deposit" : "Full",
    cumulative_paid_dzd: formatDzd(totalPaid),
    total_contract_dzd: formatDzd(saleAmount),
    remaining_balance_dzd: formatDzd(pending),
    is_brand_new: isBrandNew,
    is_used: isUsed,
    is_full_payment: isFull,
    is_deposit: isDeposit,
    _fallback_ar: fallbackAr,
  };
}

export async function generateContractDocument(
  type: TemplateType,
  input: GenerateInput
): Promise<{ buffer: Buffer; fileName: string; storagePath: string; context: Record<string, unknown> }> {
  const loaded = await loadData(input);
  const context = buildContext(type, loaded);
  const templateRel = pickTemplatePath(type);
  const templateAbs = path.resolve(process.cwd(), templateRel);
  const content = fs.readFileSync(templateAbs, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render(context);
  const buffer = doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName =
    type === "agreement"
      ? `${context.contract_reference || "contract"}`
      : `${context.receipt_reference || "receipt"}`;
  const fileName = `${baseName}-${stamp}.docx`;
  const storagePath = `${input.dealId}/${type}/${fileName}`;
  return { buffer, fileName, storagePath, context };
}
