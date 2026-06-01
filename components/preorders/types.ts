export type PreorderSource = "PRE_ORDER_CATALOG" | "PRE_ORDER_CUSTOM";

export type PreorderForm = {
  source: PreorderSource;
  date: string;
  agreed_delivery_date: string;
  notes: string;
  clientName: string;
  clientPhone: string;
  clientPassport: string;
  clientAddress: string;
  supplierId: string;
  supplierCatalogId: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  trim: string;
  options: string;
  sourceCost: string;
  sourceCurrency: "USD" | "AED";
  sourceRateToDzd: string;
  sourceRateToAed: string;
  /** DZD per 1 AED at deal time — drives sale_rate_to_aed = 1 / this (same as stock deals). */
  saleRateDzdPerAed: string;
  saleDzd: string;
  depositDzd: string;
  depositPocket: string;
  depositMethod: string;
  leadTimeDays: string;
  supplierTbd: boolean;
  requireSupplierConfirmation: boolean;
  /** When set, POST /api/deals/preorders includes inventory_car_id (sales list coming-soon car). */
  inventoryCarId: string;
  /** When set, POST includes sales_catalog_entry_id (order-on-demand catalog). */
  salesCatalogEntryId: string;
};

export function emptyPreorderForm(): PreorderForm {
  return {
    source: "PRE_ORDER_CATALOG",
    date: new Date().toISOString().slice(0, 10),
    agreed_delivery_date: "",
    notes: "",
    clientName: "",
    clientPhone: "",
    clientPassport: "",
    clientAddress: "",
    supplierId: "",
    supplierCatalogId: "",
    brand: "",
    model: "",
    year: "",
    color: "",
    trim: "",
    options: "",
    sourceCost: "",
    sourceCurrency: "USD",
    sourceRateToDzd: "",
    sourceRateToAed: "",
    saleRateDzdPerAed: "",
    saleDzd: "",
    depositDzd: "",
    depositPocket: "Algeria Cash",
    depositMethod: "cash",
    leadTimeDays: "",
    supplierTbd: false,
    requireSupplierConfirmation: true,
    inventoryCarId: "",
    salesCatalogEntryId: "",
  };
}
