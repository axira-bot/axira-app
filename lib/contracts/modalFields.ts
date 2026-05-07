import { z } from "zod";

export type DocumentMode = "agreement" | "receipt";

export type PrefillMeta = {
  dealSource: string | null;
  hasCarId: boolean;
};

export type ModalFormValues = {
  client_full_name: string;
  client_id_number: string;
  client_phone: string;
  client_email: string;
  client_address: string;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_year: string;
  vehicle_trim: string;
  vehicle_exterior_color: string;
  vehicle_interior_color: string;
  vehicle_mileage: string;
  vehicle_vin: string;
  vehicle_engine: string;
  vehicle_transmission: string;
  vehicle_fuel: string;
  vehicle_origin: string;
  vehicle_condition: string;
  vehicle_options: string;
  vehicle_disclosures: string;
  total_price_dzd: string;
  deposit_amount_dzd: string;
  balance_amount_dzd: string;
  lead_time_days: string;
  payment_type: "Full" | "Deposit";
  amount_dzd: string;
  exchange_rate: string;
};

export const DEFAULT_MODAL_VALUES: ModalFormValues = {
  client_full_name: "",
  client_id_number: "",
  client_phone: "",
  client_email: "",
  client_address: "",
  vehicle_brand: "",
  vehicle_model: "",
  vehicle_year: "",
  vehicle_trim: "",
  vehicle_exterior_color: "",
  vehicle_interior_color: "",
  vehicle_mileage: "",
  vehicle_vin: "",
  vehicle_engine: "",
  vehicle_transmission: "",
  vehicle_fuel: "",
  vehicle_origin: "",
  vehicle_condition: "Brand New",
  vehicle_options: "",
  vehicle_disclosures: "",
  total_price_dzd: "",
  deposit_amount_dzd: "",
  balance_amount_dzd: "",
  lead_time_days: "",
  payment_type: "Full",
  amount_dzd: "",
  exchange_rate: "",
};

export type ModalFieldDef = {
  key: keyof ModalFormValues;
  label: string;
  section: "Client Info" | "Vehicle Info" | "Deal Info" | "Payment Info" | "Conditional Disclosures";
  mode: DocumentMode | "both";
  input: "text" | "number" | "select";
  options?: string[];
  required: (values: ModalFormValues, meta: PrefillMeta) => boolean;
  visible?: (values: ModalFormValues, meta: PrefillMeta) => boolean;
};

export const MODAL_FIELDS: ModalFieldDef[] = [
  { key: "client_full_name", label: "Client full name", section: "Client Info", mode: "both", input: "text", required: () => true },
  { key: "client_id_number", label: "Client ID / Passport", section: "Client Info", mode: "both", input: "text", required: () => true },
  { key: "client_phone", label: "Client phone", section: "Client Info", mode: "both", input: "text", required: () => true },
  { key: "client_email", label: "Client email", section: "Client Info", mode: "both", input: "text", required: () => false },
  { key: "client_address", label: "Client address", section: "Client Info", mode: "both", input: "text", required: () => false },

  { key: "vehicle_brand", label: "Vehicle brand", section: "Vehicle Info", mode: "both", input: "text", required: () => true },
  { key: "vehicle_model", label: "Vehicle model", section: "Vehicle Info", mode: "both", input: "text", required: () => true },
  { key: "vehicle_year", label: "Vehicle year", section: "Vehicle Info", mode: "both", input: "number", required: () => true },
  { key: "vehicle_trim", label: "Vehicle trim", section: "Vehicle Info", mode: "both", input: "text", required: () => false },
  { key: "vehicle_exterior_color", label: "Exterior color", section: "Vehicle Info", mode: "both", input: "text", required: () => false },
  { key: "vehicle_interior_color", label: "Interior color", section: "Vehicle Info", mode: "both", input: "text", required: () => false },
  { key: "vehicle_mileage", label: "Mileage", section: "Vehicle Info", mode: "both", input: "number", required: () => false },
  {
    key: "vehicle_vin",
    label: "VIN",
    section: "Vehicle Info",
    mode: "both",
    input: "text",
    required: (_values, meta) => (meta.dealSource || "").toUpperCase() === "STOCK",
  },
  { key: "vehicle_engine", label: "Engine", section: "Vehicle Info", mode: "both", input: "text", required: () => false },
  { key: "vehicle_transmission", label: "Transmission", section: "Vehicle Info", mode: "both", input: "text", required: () => false },
  { key: "vehicle_fuel", label: "Fuel type", section: "Vehicle Info", mode: "both", input: "text", required: () => false },
  { key: "vehicle_origin", label: "Country of origin", section: "Vehicle Info", mode: "both", input: "text", required: () => false },
  { key: "vehicle_condition", label: "Vehicle condition", section: "Vehicle Info", mode: "both", input: "select", options: ["Brand New", "Used"], required: () => true },
  { key: "vehicle_options", label: "Options", section: "Vehicle Info", mode: "both", input: "text", required: () => false },

  { key: "total_price_dzd", label: "Total price (DZD)", section: "Deal Info", mode: "agreement", input: "number", required: () => true },
  { key: "lead_time_days", label: "Lead time (days)", section: "Deal Info", mode: "agreement", input: "number", required: () => false },
  { key: "payment_type", label: "Payment type", section: "Deal Info", mode: "agreement", input: "select", options: ["Full", "Deposit"], required: () => true },

  { key: "amount_dzd", label: "Receipt amount (DZD)", section: "Payment Info", mode: "receipt", input: "number", required: () => true },
  { key: "exchange_rate", label: "FX snapshot rate", section: "Payment Info", mode: "receipt", input: "number", required: () => true },

  {
    key: "vehicle_disclosures",
    label: "Condition disclosures",
    section: "Conditional Disclosures",
    mode: "both",
    input: "text",
    required: (values) => values.vehicle_condition === "Used",
    visible: (values) => values.vehicle_condition === "Used",
  },
  {
    key: "deposit_amount_dzd",
    label: "Deposit amount (DZD)",
    section: "Conditional Disclosures",
    mode: "agreement",
    input: "number",
    required: (values) => values.payment_type === "Deposit",
    visible: (values) => values.payment_type === "Deposit",
  },
  {
    key: "balance_amount_dzd",
    label: "Balance amount (DZD)",
    section: "Conditional Disclosures",
    mode: "agreement",
    input: "number",
    required: (values) => values.payment_type === "Deposit",
    visible: (values) => values.payment_type === "Deposit",
  },
];

const phoneRegex = /^[+\d][\d\s().-]{5,}$/;
const alnumRegex = /^[a-zA-Z0-9-_/.\s]+$/;

export function buildValidationSchema(mode: DocumentMode, meta: PrefillMeta) {
  return z
    .object({
      ...Object.fromEntries(Object.keys(DEFAULT_MODAL_VALUES).map((k) => [k, z.string().optional()])),
      payment_type: z.enum(["Full", "Deposit"]).optional(),
    })
    .superRefine((raw, ctx) => {
      const values = { ...DEFAULT_MODAL_VALUES, ...raw } as ModalFormValues;
      for (const field of MODAL_FIELDS) {
        if (field.mode !== "both" && field.mode !== mode) continue;
        if (field.visible && !field.visible(values, meta)) continue;
        const v = (values[field.key] ?? "").toString().trim();
        if (field.required(values, meta) && !v) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field.key], message: "Required" });
        }
      }
      if ((values.client_full_name || "").trim().length > 0 && (values.client_full_name || "").trim().length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["client_full_name"], message: "Minimum 3 characters" });
      }
      if ((values.client_id_number || "").trim() && !alnumRegex.test((values.client_id_number || "").trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["client_id_number"], message: "Alphanumeric only" });
      }
      if ((values.client_phone || "").trim() && !phoneRegex.test((values.client_phone || "").trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["client_phone"], message: "Invalid phone format" });
      }
      const numericFields: Array<keyof ModalFormValues> = ["vehicle_year", "vehicle_mileage", "total_price_dzd", "deposit_amount_dzd", "balance_amount_dzd", "lead_time_days", "amount_dzd", "exchange_rate"];
      for (const key of numericFields) {
        const t = (values[key] || "").trim();
        if (!t) continue;
        const n = Number(t);
        if (!Number.isFinite(n)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Numeric value required" });
          continue;
        }
        if (n < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Must be non-negative" });
      }
      if ((values.total_price_dzd || "").trim() && Number(values.total_price_dzd) <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["total_price_dzd"], message: "Must be greater than 0" });
      }
    });
}

export function sectionsForMode(mode: DocumentMode) {
  const order: ModalFieldDef["section"][] = ["Client Info", "Vehicle Info", "Deal Info", "Payment Info", "Conditional Disclosures"];
  return order
    .map((section) => ({
      section,
      fields: MODAL_FIELDS.filter((f) => f.section === section && (f.mode === "both" || f.mode === mode)),
    }))
    .filter((s) => s.fields.length > 0);
}
