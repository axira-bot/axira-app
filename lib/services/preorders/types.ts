export const DEAL_SOURCES = ["STOCK", "PRE_ORDER_CATALOG", "PRE_ORDER_CUSTOM"] as const;
export type DealSource = (typeof DEAL_SOURCES)[number];

export const DEAL_LIFECYCLE = [
  "PRE_ORDER",
  "ORDERED",
  "SHIPPED",
  "ARRIVED",
  "CLOSED",
  "CANCELLED",
] as const;
export type DealLifecycleStatus = (typeof DEAL_LIFECYCLE)[number];

export const INVENTORY_LIFECYCLE = [
  "IN_STOCK",
  "INCOMING",
  "IN_TRANSIT",
  "ARRIVED",
  "DELIVERED",
] as const;
export type InventoryLifecycleStatus = (typeof INVENTORY_LIFECYCLE)[number];

export const CANCEL_REASONS = [
  "customer_cancelled",
  "supplier_unavailable",
  "other",
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const PAYMENT_KINDS = [
  "customer_deposit",
  "customer_settlement",
  "supplier_payment",
  "refund",
  "forfeit",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const LIFECYCLE_TRANSITIONS: Record<
  DealLifecycleStatus,
  DealLifecycleStatus[]
> = {
  PRE_ORDER: ["ORDERED", "CANCELLED"],
  ORDERED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};
