import type { InvoiceItemInput, InvoiceMode, TaxScope } from "./types";

export const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const toCents = (value: number) => Math.round(money(value) * 100);
const fromCents = (value: number) => money(value / 100);

const finiteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const allocateProportionalCents = (amountCents: number, weights: number[]) => {
  const normalizedAmount = Math.max(0, Math.round(amountCents));
  const totalWeight = weights.reduce((total, weight) => total + Math.max(0, Math.round(weight)), 0);
  if (!normalizedAmount || !totalWeight) return weights.map(() => 0);

  const allocations = weights.map((weight, index) => {
    const normalizedWeight = Math.max(0, Math.round(weight));
    const exact = (normalizedAmount * normalizedWeight) / totalWeight;
    const base = Math.floor(exact);
    return { index, base, remainder: exact - base, weight: normalizedWeight };
  });

  let remaining = normalizedAmount - allocations.reduce((total, item) => total + item.base, 0);
  allocations
    .slice()
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index)
    .forEach((item) => {
      if (remaining <= 0) return;
      item.base += 1;
      remaining -= 1;
    });

  return allocations.sort((a, b) => a.index - b.index).map((item) => item.base);
};

export const calculateInvoiceTotals = (invoiceMode: InvoiceMode, taxScope: TaxScope, items: InvoiceItemInput[], rawDiscount: number) => {
  const normalized = items.map((item) => ({
    ...item,
    description: String(item.description ?? "").trim(),
    quantity: money(finiteNumber(item.quantity)),
    unitPrice: money(finiteNumber(item.unitPrice)),
    gstRate: invoiceMode === "gst" ? money(finiteNumber(item.gstRate ?? 0)) : 0,
    sacCode: item.sacCode?.trim() || "9987",
    lineSubTotal: money(finiteNumber(item.quantity) * finiteNumber(item.unitPrice))
  }));
  const subTotal = money(normalized.reduce((sum, item) => sum + item.lineSubTotal, 0));
  const discount = money(Math.min(Math.max(finiteNumber(rawDiscount), 0), subTotal));
  const taxableBase = money(subTotal - discount);
  const taxableLineCents = allocateProportionalCents(
    toCents(taxableBase),
    normalized.map((item) => toCents(item.lineSubTotal))
  );

  const calculatedItems = normalized.map((item, index) => {
    const lineTaxable = fromCents(taxableLineCents[index] || 0);
    const lineTax = invoiceMode === "gst" ? money((lineTaxable * item.gstRate) / 100) : 0;
    return {
      ...item,
      lineTax,
      lineTotal: money(lineTaxable + lineTax)
    };
  });

  const totalTax = money(calculatedItems.reduce((sum, item) => sum + item.lineTax, 0));
  const cgst = invoiceMode === "gst" && taxScope === "intra" ? money(totalTax / 2) : 0;
  const sgst = invoiceMode === "gst" && taxScope === "intra" ? money(totalTax - cgst) : 0;
  const igst = invoiceMode === "gst" && taxScope === "inter" ? totalTax : 0;

  return {
    items: calculatedItems,
    subTotal,
    discount,
    taxableValue: invoiceMode === "gst" ? taxableBase : 0,
    cgst,
    sgst,
    igst,
    totalTax,
    grandTotal: money(taxableBase + totalTax)
  };
};
