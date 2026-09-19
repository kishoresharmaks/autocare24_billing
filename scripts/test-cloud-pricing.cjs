const assert = require("node:assert/strict");
const fs = require("node:fs");

const serverJs = fs.readFileSync("cloud-api/src/server.js", "utf8").replace(/\r\n/g, "\n");

const mathCode = `
const crypto = require("node:crypto");
const MONEY_SCALE = 100n;
const GST_RATE_SCALE = 10000n;
const DEFAULT_SAC_CODE = "9987";
const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const expandExponential = (value) => {
  const [coefficient, exponentValue] = value.toLowerCase().split("e");
  const exponent = Number(exponentValue);
  if (!coefficient || !Number.isInteger(exponent)) return value;
  const sign = coefficient.startsWith("-") ? "-" : "";
  const unsignedCoefficient = coefficient.replace(/^-/, "");
  const [integerPart = "0", fractionalPart = ""] = unsignedCoefficient.split(".");
  const digits = \`\${integerPart}\${fractionalPart}\`.replace(/^0+(?=\\d)/, "") || "0";
  const decimalIndex = integerPart.length + exponent;
  if (decimalIndex <= 0) return \`\${sign}0.\${"0".repeat(Math.abs(decimalIndex))}\${digits}\`;
  if (decimalIndex >= digits.length) return \`\${sign}\${digits}\${"0".repeat(decimalIndex - digits.length)}\`;
  return \`\${sign}\${digits.slice(0, decimalIndex)}.\${digits.slice(decimalIndex)}\`;
};
const toScaledInteger = (value, decimals) => {
  if (!Number.isFinite(value)) return 0n;
  const normalized = expandExponential(value.toString());
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsignedValue = normalized.replace(/^-/, "");
  const [integerPart = "0", fractionalPart = ""] = unsignedValue.split(".");
  const scale = 10n ** BigInt(decimals);
  const normalizedInteger = integerPart.replace(/\\D/g, "") || "0";
  const normalizedFraction = fractionalPart.replace(/\\D/g, "");
  const scaledFraction = normalizedFraction.padEnd(decimals + 1, "0");
  const baseFraction = scaledFraction.slice(0, decimals) || "0";
  const roundingDigit = Number(scaledFraction[decimals] || "0");
  const base = BigInt(normalizedInteger) * scale + BigInt(baseFraction);
  return sign * (base + (roundingDigit >= 5 ? 1n : 0n));
};
const divideRounded = (numerator, denominator) => {
  if (denominator === 0n) return 0n;
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
  return sign * rounded;
};
const compareBigIntDescending = (left, right) => (left === right ? 0 : left > right ? -1 : 1);
const toCents = (value) => toScaledInteger(value, 2);
const fromCents = (value) => Number(value) / Number(MONEY_SCALE);
const toGstRateUnits = (value) => toScaledInteger(value, 4);
const calculatePercentCents = (amountCents, ratePercent) =>
  divideRounded(amountCents * toGstRateUnits(ratePercent), 100n * GST_RATE_SCALE);
const money = (value) => fromCents(toCents(value));
const normalizeSacCode = (value, fallback = DEFAULT_SAC_CODE) => {
  const code = String(value || "").trim();
  if (/^\\d{4,8}$/.test(code)) return code;
  return fallback;
};
const normalizeTaxScope = (value) => String(value || "") === "inter" ? "inter" : "intra";
const normalizeInvoiceMode = (value) => String(value || "") === "simple" ? "simple" : "gst";
const normalizePricingMode = (value) => String(value || "") === "inclusive" ? "inclusive" : "exclusive";
const allocateProportionalCents = (amountCents, weights) => {
  const normalizedAmount = amountCents > 0n ? amountCents : 0n;
  const normalizedWeights = weights.map((weight) => (weight > 0n ? weight : 0n));
  const totalWeight = normalizedWeights.reduce((total, weight) => total + weight, 0n);
  if (!normalizedAmount || !totalWeight) return weights.map(() => 0n);
  const allocations = normalizedWeights.map((weight, index) => {
    const weightedAmount = normalizedAmount * weight;
    return { index, base: weightedAmount / totalWeight, remainder: weightedAmount % totalWeight, weight };
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
`;

const fnMatch = serverJs.match(/const calculateInvoiceTotals = \([\s\S]*?\n\};\n/);
if (!fnMatch) {
  throw new Error("Could not find calculateInvoiceTotals in cloud-api/src/server.js");
}

const fullScript = `${mathCode}\n${fnMatch[0]}\nreturn calculateInvoiceTotals;`;
const calculateInvoiceTotalsCloud = new Function("require", fullScript)(require);

console.log("Testing cloud-api calculateInvoiceTotals:");

// Test 1: User's exact scenario: Service ₹300 with 18% GST in inclusive mode
const userScenario = calculateInvoiceTotalsCloud(
  "gst",
  "intra",
  [{ description: "EXTERIOR WASH - CAR", quantity: 1, unitPrice: 300, gstRate: 18, sacCode: "9987" }],
  0,
  "inclusive"
);

console.log("User scenario (Inclusive ₹300, 18% GST):", userScenario);
assert.equal(userScenario.subTotal, 300.00);
assert.equal(userScenario.taxableValue, 254.24);
assert.equal(userScenario.cgst, 22.88);
assert.equal(userScenario.sgst, 22.88);
assert.equal(userScenario.totalTax, 45.76);
assert.equal(userScenario.grandTotal, 300.00);
assert.equal(userScenario.items[0].lineSubTotal, 300.00);
assert.equal(userScenario.items[0].lineTax, 45.76);
assert.equal(userScenario.items[0].lineTotal, 300.00);
console.log("✓ User scenario matches exactly: Grand Total ₹300.00 (Taxable ₹254.24, CGST ₹22.88, SGST ₹22.88)");

// Test 2: Standard Exclusive mode (default)
const exclusiveScenario = calculateInvoiceTotalsCloud(
  "gst",
  "intra",
  [{ description: "EXTERIOR WASH - CAR", quantity: 1, unitPrice: 300, gstRate: 18, sacCode: "9987" }],
  0,
  "exclusive"
);
console.log("Exclusive scenario (₹300 + 18% GST):", exclusiveScenario);
assert.equal(exclusiveScenario.subTotal, 300.00);
assert.equal(exclusiveScenario.taxableValue, 300.00);
assert.equal(exclusiveScenario.cgst, 27.00);
assert.equal(exclusiveScenario.sgst, 27.00);
assert.equal(exclusiveScenario.totalTax, 54.00);
assert.equal(exclusiveScenario.grandTotal, 354.00);
assert.equal(exclusiveScenario.items[0].lineTotal, 354.00);
console.log("✓ Exclusive mode preserves ₹354.00 grand total");

// Test 3: Inter-state (IGST) inclusive
const interStateInclusive = calculateInvoiceTotalsCloud(
  "gst",
  "inter",
  [{ description: "Product", quantity: 1, unitPrice: 1000, gstRate: 18, sacCode: "9987" }],
  0,
  "inclusive"
);
assert.equal(interStateInclusive.grandTotal, 1000.00);
assert.equal(interStateInclusive.taxableValue, 847.46);
assert.equal(interStateInclusive.igst, 152.54);
assert.equal(interStateInclusive.cgst, 0);
assert.equal(interStateInclusive.sgst, 0);
console.log("✓ Inter-state inclusive uses IGST and exact ₹1000 grand total");

// Test 4: Inclusive with discount
const inclusiveWithDiscount = calculateInvoiceTotalsCloud(
  "gst",
  "intra",
  [{ description: "Service", quantity: 1, unitPrice: 300, gstRate: 18, sacCode: "9987" }],
  50,
  "inclusive"
);
assert.equal(inclusiveWithDiscount.subTotal, 300.00);
assert.equal(inclusiveWithDiscount.discount, 50.00);
assert.equal(inclusiveWithDiscount.grandTotal, 250.00);
assert.equal(inclusiveWithDiscount.taxableValue, 211.86);
assert.equal(inclusiveWithDiscount.totalTax, 38.14);
assert.equal(inclusiveWithDiscount.cgst, 19.07);
assert.equal(inclusiveWithDiscount.sgst, 19.07);
console.log("✓ Inclusive with discount keeps exact ₹250.00 net grand total");

console.log("\nAll cloud-api pricing mode calculations verified successfully!");
