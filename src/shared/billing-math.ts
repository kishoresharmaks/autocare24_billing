import type { InvoiceItemInput, InvoiceMode, TaxScope } from "./types";

const MONEY_SCALE = 100n;
const GST_RATE_SCALE = 10000n;
export const DEFAULT_SAC_CODE = "9987";

export const normalizeSacCode = (value: unknown, fallback = DEFAULT_SAC_CODE) => {
  const code = String(value ?? "").trim();
  if (/^\d{4,8}$/.test(code)) return code;
  return fallback;
};

const expandExponential = (value: string) => {
  const [coefficient, exponentValue] = value.toLowerCase().split("e");
  const exponent = Number(exponentValue);
  if (!coefficient || !Number.isInteger(exponent)) return value;

  const sign = coefficient.startsWith("-") ? "-" : "";
  const unsignedCoefficient = coefficient.replace(/^-/, "");
  const [integerPart = "0", fractionalPart = ""] = unsignedCoefficient.split(".");
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalIndex = integerPart.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  }

  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }

  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
};

const toScaledInteger = (value: number, decimals: number) => {
  if (!Number.isFinite(value)) return 0n;

  const normalized = expandExponential(value.toString());
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsignedValue = normalized.replace(/^-/, "");
  const [integerPart = "0", fractionalPart = ""] = unsignedValue.split(".");
  const scale = 10n ** BigInt(decimals);
  const normalizedInteger = integerPart.replace(/\D/g, "") || "0";
  const normalizedFraction = fractionalPart.replace(/\D/g, "");
  const scaledFraction = normalizedFraction.padEnd(decimals + 1, "0");
  const baseFraction = scaledFraction.slice(0, decimals) || "0";
  const roundingDigit = Number(scaledFraction[decimals] || "0");
  const base = BigInt(normalizedInteger) * scale + BigInt(baseFraction);

  return sign * (base + (roundingDigit >= 5 ? 1n : 0n));
};

const divideRounded = (numerator: bigint, denominator: bigint) => {
  if (denominator === 0n) return 0n;

  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;

  return sign * rounded;
};

const compareBigIntDescending = (left: bigint, right: bigint) => (left === right ? 0 : left > right ? -1 : 1);

const toCents = (value: number) => toScaledInteger(value, 2);
const fromCents = (value: bigint) => Number(value) / Number(MONEY_SCALE);
const toGstRateUnits = (value: number) => toScaledInteger(value, 4);
const calculatePercentCents = (amountCents: bigint, ratePercent: number) =>
  divideRounded(amountCents * toGstRateUnits(ratePercent), 100n * GST_RATE_SCALE);

export const money = (value: number) => fromCents(toCents(value));

const finiteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const allocateProportionalCents = (amountCents: bigint, weights: bigint[]) => {
  const normalizedAmount = amountCents > 0n ? amountCents : 0n;
  const normalizedWeights = weights.map((weight) => (weight > 0n ? weight : 0n));
  const totalWeight = normalizedWeights.reduce((total, weight) => total + weight, 0n);
  if (!normalizedAmount || !totalWeight) return weights.map(() => 0n);

  const allocations = normalizedWeights.map((weight, index) => {
    const weightedAmount = normalizedAmount * weight;
    const base = weightedAmount / totalWeight;
    const remainder = weightedAmount % totalWeight;
    return { index, base, remainder, weight };
  });

  let remaining = normalizedAmount - allocations.reduce((total, item) => total + item.base, 0n);
  allocations
    .slice()
    .sort((a, b) => compareBigIntDescending(a.remainder, b.remainder) || compareBigIntDescending(a.weight, b.weight) || a.index - b.index)
    .forEach((item) => {
      if (remaining <= 0n) return;
      item.base += 1n;
      remaining -= 1n;
    });

  return allocations.sort((a, b) => a.index - b.index).map((item) => item.base);
};

export const calculateInvoiceTotals = (invoiceMode: InvoiceMode, taxScope: TaxScope, items: InvoiceItemInput[], rawDiscount: number) => {
  const normalized = items.map((item) => {
    const quantityCents = toCents(finiteNumber(item.quantity));
    const unitPriceCents = toCents(finiteNumber(item.unitPrice));
    const lineSubTotalCents = divideRounded(quantityCents * unitPriceCents, MONEY_SCALE);

    return {
      ...item,
      description: String(item.description ?? "").trim(),
      quantity: fromCents(quantityCents),
      unitPrice: fromCents(unitPriceCents),
      gstRate: invoiceMode === "gst" ? money(finiteNumber(item.gstRate ?? 0)) : 0,
      sacCode: normalizeSacCode(item.sacCode),
      lineSubTotal: fromCents(lineSubTotalCents),
      lineSubTotalCents
    };
  });
  const subTotalCents = normalized.reduce((sum, item) => sum + item.lineSubTotalCents, 0n);
  const subTotal = fromCents(subTotalCents);
  const discountCents = toCents(Math.min(Math.max(finiteNumber(rawDiscount), 0), subTotal));
  const taxableBaseCents = subTotalCents - discountCents;
  const taxableBase = fromCents(taxableBaseCents);
  const taxableLineCents = allocateProportionalCents(
    taxableBaseCents,
    normalized.map((item) => item.lineSubTotalCents)
  );

  const calculatedItems = normalized.map((item, index) => {
    const lineTaxableCents = taxableLineCents[index] || 0n;
    const lineTaxCents = invoiceMode === "gst" ? calculatePercentCents(lineTaxableCents, item.gstRate) : 0n;
    const { lineSubTotalCents: _lineSubTotalCents, ...publicItem } = item;
    const lineTax = fromCents(lineTaxCents);
    return {
      ...publicItem,
      lineTax,
      lineTotal: fromCents(lineTaxableCents + lineTaxCents)
    };
  });

  const totalTaxCents = calculatedItems.reduce((sum, item) => sum + toCents(item.lineTax), 0n);
  const cgstCents = invoiceMode === "gst" && taxScope === "intra" ? divideRounded(totalTaxCents, 2n) : 0n;
  const sgstCents = invoiceMode === "gst" && taxScope === "intra" ? totalTaxCents - cgstCents : 0n;
  const igstCents = invoiceMode === "gst" && taxScope === "inter" ? totalTaxCents : 0n;

  return {
    items: calculatedItems,
    subTotal,
    discount: fromCents(discountCents),
    taxableValue: invoiceMode === "gst" ? taxableBase : 0,
    cgst: fromCents(cgstCents),
    sgst: fromCents(sgstCents),
    igst: fromCents(igstCents),
    totalTax: fromCents(totalTaxCents),
    grandTotal: fromCents(taxableBaseCents + totalTaxCents)
  };
};
