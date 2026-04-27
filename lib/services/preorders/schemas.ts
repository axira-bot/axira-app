import { z } from "zod";
import {
  CANCEL_REASONS,
  DEAL_LIFECYCLE,
  DEAL_SOURCES,
  PAYMENT_KINDS,
} from "./types";

const uuid = z.string().uuid();
const money = z.number().finite();

export const preOrderCreateSchema = z.object({
  source: z.enum(DEAL_SOURCES).refine((v) => v !== "STOCK"),
  date: z.string().min(8),
  agreed_delivery_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  rate: money.positive(),
  sale_dzd: money.positive(),
  source_cost: money.nonnegative(),
  source_currency: z.enum(["USD", "AED"]),
  source_rate_to_dzd: money.positive(),
  source_rate_to_aed: money.positive(),
  client: z.object({
    id: uuid.optional(),
    name: z.string().min(2),
    phone: z.string().min(5),
    passport_number: z.string().optional().nullable(),
    algeria_address: z.string().optional().nullable(),
  }),
  catalog: z
    .object({
      supplier_id: uuid,
      supplier_catalog_id: uuid,
      brand: z.string().min(1),
      model: z.string().min(1),
      year: z.number().int().optional().nullable(),
      trim: z.string().optional().nullable(),
      color: z.string().optional().nullable(),
      lead_time_days: z.number().int().optional().nullable(),
    })
    .optional(),
  custom_spec: z
    .object({
      supplier_id: uuid.optional().nullable(),
      supplier_tbd: z.boolean().default(false),
      brand: z.string().min(1),
      model: z.string().min(1),
      year: z.number().int().optional().nullable(),
      color: z.string().optional().nullable(),
      trim: z.string().optional().nullable(),
      options: z.string().optional().nullable(),
      estimated_cost: money.nonnegative(),
      estimated_currency: z.enum(["USD", "AED"]),
      supplier_confirmation_required: z.boolean().default(true),
    })
    .optional(),
  deposit: z
    .object({
      amount_dzd: money.positive(),
      pocket: z.string().min(2),
      method: z.string().min(2),
      date: z.string().min(8).optional(),
      notes: z.string().optional().nullable(),
    })
    .optional(),
});

export const supplierConfirmationSchema = z.object({
  confirmed: z.boolean(),
});

export const transitionSchema = z.object({
  to_status: z.enum(DEAL_LIFECYCLE),
  note: z.string().optional().nullable(),
});

export const supplierPaymentSchema = z.object({
  supplier_id: uuid,
  amount: money.positive(),
  currency: z.enum(["USD", "AED"]),
  rate_snapshot: money.positive(),
  pocket: z.string().min(2),
  method: z.string().min(2),
  reference: z.string().optional().nullable(),
  date: z.string().min(8).optional(),
  brand: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().optional().nullable(),
  color: z.string().optional().nullable(),
  trim: z.string().optional().nullable(),
});

export const assignVinSchema = z.object({
  vin: z.string().min(5),
});

export const cancelSchema = z.object({
  reason: z.enum(CANCEL_REASONS),
  note: z.string().optional().nullable(),
  deposit_action: z.enum(["refund", "forfeit"]).optional(),
  inventory_action: z.enum(["refund_supplier", "convert_to_stock"]).optional(),
});

export const paymentSchema = z.object({
  kind: z.enum(PAYMENT_KINDS),
  amount: money.positive(),
  currency: z.enum(["DZD", "USD", "AED"]),
  rate_snapshot: money.positive(),
  pocket: z.string().min(2),
  method: z.string().min(2),
  date: z.string().min(8).optional(),
  notes: z.string().optional().nullable(),
});
