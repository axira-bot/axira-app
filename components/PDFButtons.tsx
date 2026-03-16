"use client";

import { useState } from "react";
import type { InvoicePDFData, SalesAgreementPDFData, ReceiptPDFData } from "@/lib/pdf/pdfTypes";

const btnClass =
  "inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function InvoiceDownloadButton({
  data,
  filename,
}: {
  data: InvoicePDFData;
  filename?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const [{ pdf }, { InvoicePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/pdf/InvoicePDF"),
      ]);
      const blob = await pdf(<InvoicePDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `Invoice-${data.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Invoice PDF error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`${btnClass} border-[#F1E193]/40 bg-[#F1E193]/10 text-[#F1E193] hover:bg-[#F1E193]/20`}
    >
      {loading ? "Generating..." : "Invoice"}
    </button>
  );
}

export function AgreementDownloadButton({
  data,
  filename,
}: {
  data: SalesAgreementPDFData;
  filename?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const [{ pdf }, { SalesAgreementPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/pdf/SalesAgreementPDF"),
      ]);
      const blob = await pdf(<SalesAgreementPDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `Agreement-${data.clientName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Agreement PDF error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`${btnClass} border-[#5B0F15]/60 bg-[#5B0F15]/20 text-[#F5EDD8] hover:bg-[#5B0F15]/40`}
    >
      {loading ? "Generating..." : "Agreement"}
    </button>
  );
}

export function ReceiptDownloadButton({
  data,
  label = "Print Receipt",
  className,
}: {
  data: ReceiptPDFData;
  label?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const [{ pdf }, { ReceiptPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/pdf/ReceiptPDF"),
      ]);
      const blob = await pdf(<ReceiptPDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Receipt-${data.receiptNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Receipt PDF error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={
        className ??
        `${btnClass} border-[#C41230]/50 bg-[#C41230]/10 text-[#C41230] hover:bg-[#C41230]/20`
      }
    >
      {loading ? "Generating..." : label}
    </button>
  );
}
