export interface InvoicePDFData {
  invoiceNumber: string;
  date: string;
  clientName: string;
  clientPhone?: string | null;
  carBrand: string;
  carModel: string;
  carYear: number | null;
  carColor?: string | null;
  carVin?: string | null;
  countryOfOrigin?: string | null;
  saleUsd: number;
  exportTo: string;
}

export interface SalesAgreementPDFData {
  date: string;
  clientName: string;
  clientPassport?: string | null;
  carBrand: string;
  carModel: string;
  carYear: number | null;
  carColor?: string | null;
  carVin?: string | null;
  countryOfOrigin?: string | null;
  totalAmountUsd: number;
  advanceUsd: number;
  balanceUsd: number;
}

export interface ReceiptPDFData {
  receiptNumber: string;
  date: string;
  time?: string;
  type: string;           // e.g. "Currency Conversion", "Cash Exchange", "Expense", "Income"
  rows: { label: string; value: string; highlight?: boolean }[];
  notes?: string;
  doneBy?: string;
  approvedBy?: string;
}
