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
  saleDzd: string;
  depositDzd: string;
  depositPocket: string;
  depositMethod: string;
  leadTimeDays: string;
  supplierTbd: boolean;
  requireSupplierConfirmation: boolean;
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
    saleDzd: "",
    depositDzd: "",
    depositPocket: "Algeria Cash",
    depositMethod: "cash",
    leadTimeDays: "",
    supplierTbd: false,
    requireSupplierConfirmation: true,
  };
}
