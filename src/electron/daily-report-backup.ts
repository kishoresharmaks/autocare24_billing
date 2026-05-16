import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  InventoryBatch,
  InventoryDashboardData,
  InventoryMovement,
  InvoiceSummary,
  Payment,
  PaymentMode,
  PurchaseRecord,
  ReportData,
  Supplier
} from "../shared/types";

type DailyReportSource = "cloud-api" | "local-database";
type InventorySnapshot = InventoryDashboardData & {
  batches?: Array<InventoryBatch & { itemName?: string; unit?: string }>;
  movements?: InventoryMovement[];
};

export interface DailyReportArchiveInput {
  outputRoot: string;
  reportDate: string;
  generatedAt: string;
  timezone: string;
  source: DailyReportSource;
  sourceDevice: string;
  sourceStatus: string;
  report: ReportData;
  allDuesReport: ReportData;
  invoices: InvoiceSummary[];
  payments: Payment[];
  inventory: InventorySnapshot;
  suppliers: Supplier[];
  purchaseRecords: PurchaseRecord[];
}

export interface DailyReportArchiveResult {
  filePath: string;
  reportDate: string;
  generatedAt: string;
  source: DailyReportSource;
  sizeBytes: number;
}

type ZipEntry = { name: string; data: Buffer; mtime?: Date };
type DuesBucketKey = "today" | "1-7" | "8-15" | "16-30" | "31+";

const PAYMENT_MODES: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const DUES_BUCKETS: DuesBucketKey[] = ["today", "1-7", "8-15", "16-30", "31+"];
const money = (value: unknown) => Math.round((Number.isFinite(Number(value)) ? Number(value) : 0) * 100) / 100;
const text = (value: unknown) => String(value ?? "").trim();
const csvEscape = (value: unknown) => {
  const valueText = String(value ?? "");
  return /[",\n\r]/.test(valueText) ? `"${valueText.replace(/"/g, '""')}"` : valueText;
};
const rowsToCsv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const first = rows[0];
  if (!first) return "";
  const headers = Object.keys(first);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
};
const jsonBuffer = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2), "utf8");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const safeSegment = (value: string, fallback: string) =>
  text(value).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || fallback;
const toLocalDate = (value: string) => text(value).slice(0, 10);
const formatMoney = (value: unknown) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatNumber = (value: unknown) => money(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const daysBetween = (fromDate: string, toDate: string) => {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
};
const duesBucketFor = (invoiceDate: string, reportDate: string): DuesBucketKey => {
  const age = daysBetween(invoiceDate, reportDate);
  if (age <= 0) return "today";
  if (age <= 7) return "1-7";
  if (age <= 15) return "8-15";
  if (age <= 30) return "16-30";
  return "31+";
};
const truncate = (value: unknown, width: number) => {
  const valueText = String(value ?? "");
  return valueText.length <= width ? valueText.padEnd(width, " ") : `${valueText.slice(0, Math.max(0, width - 1))} `;
};
const lineTable = (headers: string[], rows: Array<Array<string | number>>, widths: number[]) => [
  headers.map((header, index) => truncate(header, widths[index] ?? 12)).join(" "),
  widths.map((width) => "-".repeat(width)).join(" "),
  ...rows.map((row) => row.map((cell, index) => truncate(cell, widths[index] ?? 12)).join(" "))
];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (data: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
};

const createZip = (entries: ZipEntry[]) => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    const nameBuffer = Buffer.from(name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const { time, date } = dosDateTime(entry.mtime || new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

const pdfEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const wrapLine = (line: string, width: number) => {
  if (line.length <= width) return [line];
  const words = line.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [line.slice(0, width)];
};

const createTextPdf = (lines: string[]) => {
  const wrapped = lines.flatMap((line) => (line ? wrapLine(line, 96) : [""]));
  const linesPerPage = 54;
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += linesPerPage) {
    pages.push(wrapped.slice(index, index + linesPerPage));
  }
  if (!pages.length) pages.push(["Autocare24 Daily Report"]);

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];

  pages.forEach((pageLines) => {
    const stream = [
      "BT",
      "/F1 9 Tf",
      "12 TL",
      "42 790 Td",
      ...pageLines.map((line, index) => `${index ? "T* " : ""}(${pdfEscape(line)}) Tj`),
      "ET"
    ].join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(parts.join(""), "utf8"));
    parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = Buffer.byteLength(parts.join(""), "utf8");
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`));
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(parts.join(""), "utf8");
};

const buildDailyReport = (input: DailyReportArchiveInput) => {
  const dailyInvoices = input.invoices.filter((invoice) => toLocalDate(invoice.invoiceDate) === input.reportDate);
  const activeDailyInvoices = dailyInvoices.filter((invoice) => invoice.invoiceStatus !== "cancelled");
  const cancelledDailyInvoices = dailyInvoices.filter((invoice) => invoice.invoiceStatus === "cancelled");
  const dueInvoices = (input.allDuesReport.dues || []).filter((invoice) => money(invoice.balanceDue) > 0);
  const newDuesToday = activeDailyInvoices.filter((invoice) => money(invoice.balanceDue) > 0);
  const paymentsToday = input.payments.filter((payment) => toLocalDate(payment.paymentDate) === input.reportDate);
  const movementsToday = (input.inventory.movements || input.inventory.recentMovements || [])
    .filter((movement) => toLocalDate(movement.movementDate) === input.reportDate);
  const supplierMap = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]));
  const batchMap = new Map((input.inventory.batches || []).map((batch) => [batch.id, batch]));

  const salesSummary = {
    reportDate: input.reportDate,
    generatedAt: input.generatedAt,
    source: input.source,
    invoiceCount: activeDailyInvoices.length,
    cancelledCount: cancelledDailyInvoices.length,
    grossBilledValue: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.subTotal), 0)),
    discount: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.discount), 0)),
    taxableValue: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.taxableValue), 0)),
    cgst: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.cgst), 0)),
    sgst: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.sgst), 0)),
    igst: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.igst), 0)),
    totalTax: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.totalTax), 0)),
    grandTotal: money(activeDailyInvoices.reduce((sum, invoice) => sum + money(invoice.grandTotal), 0)),
    paidAmount: money(input.report.paidAmount),
    balanceDueCreatedToday: money(newDuesToday.reduce((sum, invoice) => sum + money(invoice.balanceDue), 0)),
    closingTotalDues: money(dueInvoices.reduce((sum, invoice) => sum + money(invoice.balanceDue), 0))
  };

  const paymentRows = PAYMENT_MODES.map((mode) => ({
    mode,
    amount: money((input.report.paymentModes || []).find((row) => row.mode === mode)?.amount || 0),
    paymentCount: paymentsToday.filter((payment) => payment.mode === mode).length
  }));

  const duesAgingRows = DUES_BUCKETS.map((bucket) => {
    const invoices = dueInvoices.filter((invoice) => duesBucketFor(invoice.invoiceDate, input.reportDate) === bucket);
    return {
      bucket,
      invoiceCount: invoices.length,
      balanceDue: money(invoices.reduce((sum, invoice) => sum + money(invoice.balanceDue), 0))
    };
  });

  const stockSummary = {
    reportDate: input.reportDate,
    totalStockValue: money(input.inventory.totalStockValue),
    lowStockCount: input.inventory.lowStockCount,
    expiringCount: input.inventory.expiringCount,
    retailCount: input.inventory.retailCount,
    movementCount: movementsToday.length
  };

  const invoiceRows = dailyInvoices.map((invoice) => ({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    customer: invoice.customerName,
    phone: invoice.customerPhone,
    vehicle: invoice.vehicleNumber,
    subTotal: invoice.subTotal,
    discount: invoice.discount,
    taxableValue: invoice.taxableValue,
    cgst: invoice.cgst,
    sgst: invoice.sgst,
    igst: invoice.igst,
    totalTax: invoice.totalTax,
    grandTotal: invoice.grandTotal,
    paidAmount: invoice.paidAmount,
    balanceDue: invoice.balanceDue,
    paymentStatus: invoice.paymentStatus,
    paymentMode: invoice.paymentMode,
    invoiceStatus: invoice.invoiceStatus,
    cancelReason: invoice.cancelReason
  }));
  const dueRows = dueInvoices.map((invoice) => ({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    customer: invoice.customerName,
    phone: invoice.customerPhone,
    vehicle: invoice.vehicleNumber,
    grandTotal: invoice.grandTotal,
    paidAmount: invoice.paidAmount,
    balanceDue: invoice.balanceDue,
    ageDays: daysBetween(invoice.invoiceDate, input.reportDate),
    agingBucket: duesBucketFor(invoice.invoiceDate, input.reportDate),
    paymentStatus: invoice.paymentStatus
  }));
  const stockItemRows = (input.inventory.items || []).map((item) => ({
    name: item.name,
    sku: item.sku,
    category: item.category,
    type: item.type,
    unit: item.unit,
    currentQuantity: item.currentQuantity,
    lowStockLevel: item.lowStockLevel,
    stockValue: item.stockValue,
    retailPrice: item.retailPrice,
    active: item.active ? "yes" : "no",
    alert: item.active && item.lowStockLevel > 0 && item.currentQuantity <= item.lowStockLevel ? "low_stock" : ""
  }));
  const lowStockRows = (input.inventory.lowStockItems || []).map((item) => ({
    name: item.name,
    sku: item.sku,
    category: item.category,
    currentQuantity: item.currentQuantity,
    unit: item.unit,
    lowStockLevel: item.lowStockLevel,
    stockValue: item.stockValue
  }));
  const expiringBatchRows = (input.inventory.expiringBatches || []).map((batch) => {
    const supplier = supplierMap.get(batch.supplierId);
    return {
      itemName: batch.itemName || batch.itemId,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      remainingQuantity: batch.quantityRemaining,
      unit: batch.unit || "",
      unitCost: batch.unitCost,
      billNumber: batch.billNumber,
      supplier: supplier?.name || ""
    };
  });
  const stockMovementRows = movementsToday.map((movement) => {
    const batch = batchMap.get(movement.batchId);
    const supplier = batch ? supplierMap.get(batch.supplierId) : null;
    return {
      date: movement.movementDate,
      item: movement.itemName,
      type: movement.type,
      quantity: movement.quantity,
      unit: movement.itemUnit,
      unitCost: movement.unitCost,
      value: money(movement.quantity * movement.unitCost),
      reference: movement.reference,
      batchNumber: batch?.batchNumber || "",
      billNumber: batch?.billNumber || "",
      supplier: supplier?.name || "",
      notes: movement.notes
    };
  });

  return {
    salesSummary,
    paymentRows,
    duesAgingRows,
    stockSummary,
    invoiceRows,
    dueRows,
    stockItemRows,
    lowStockRows,
    expiringBatchRows,
    stockMovementRows,
    raw: {
      reportDate: input.reportDate,
      generatedAt: input.generatedAt,
      timezone: input.timezone,
      source: input.source,
      sourceDevice: input.sourceDevice,
      sourceStatus: input.sourceStatus,
      salesSummary,
      payments: paymentRows,
      duesAging: duesAgingRows,
      stockSummary,
      invoices: dailyInvoices,
      paymentsToday,
      topServices: input.report.topServices || [],
      allPendingDues: dueInvoices,
      inventory: input.inventory,
      suppliers: input.suppliers,
      purchaseRecords: input.purchaseRecords
    }
  };
};

const buildPdfLines = (input: DailyReportArchiveInput, report: ReturnType<typeof buildDailyReport>) => [
  "Autocare24 Daily Report Backup",
  `Report date: ${input.reportDate}`,
  `Generated at: ${input.generatedAt}`,
  `Timezone: ${input.timezone}`,
  `Source: ${input.source} (${input.sourceStatus})`,
  `Device: ${input.sourceDevice}`,
  "",
  "Sales Summary",
  `Invoices: ${report.salesSummary.invoiceCount} active, ${report.salesSummary.cancelledCount} cancelled`,
  `Gross billed: ${formatMoney(report.salesSummary.grossBilledValue)}`,
  `Discount: ${formatMoney(report.salesSummary.discount)}`,
  `Taxable value: ${formatMoney(report.salesSummary.taxableValue)}`,
  `CGST: ${formatMoney(report.salesSummary.cgst)} | SGST: ${formatMoney(report.salesSummary.sgst)} | IGST: ${formatMoney(report.salesSummary.igst)} | Tax: ${formatMoney(report.salesSummary.totalTax)}`,
  `Grand total: ${formatMoney(report.salesSummary.grandTotal)}`,
  `Collected today: ${formatMoney(report.salesSummary.paidAmount)}`,
  "",
  "Payments By Mode",
  ...lineTable(["Mode", "Amount", "Count"], report.paymentRows.map((row) => [row.mode, formatMoney(row.amount), row.paymentCount]), [18, 18, 8]),
  "",
  "Pending Dues Snapshot",
  `New dues from today's invoices: ${formatMoney(report.salesSummary.balanceDueCreatedToday)}`,
  `Closing total dues: ${formatMoney(report.salesSummary.closingTotalDues)}`,
  ...lineTable(["Age", "Invoices", "Balance"], report.duesAgingRows.map((row) => [row.bucket, row.invoiceCount, formatMoney(row.balanceDue)]), [10, 10, 18]),
  "",
  "Stock Snapshot",
  `Closing stock value: ${formatMoney(report.stockSummary.totalStockValue)}`,
  `Low stock items: ${report.stockSummary.lowStockCount}`,
  `Expiring batches: ${report.stockSummary.expiringCount}`,
  `Retail items: ${report.stockSummary.retailCount}`,
  `Stock movements today: ${report.stockSummary.movementCount}`,
  "",
  "Top Services / Items",
  ...lineTable(
    ["Name", "Qty", "Revenue"],
    (input.report.topServices || []).slice(0, 12).map((row) => [row.name, formatNumber(row.quantity), formatMoney(row.revenue)]),
    [46, 10, 18]
  ),
  "",
  "Largest Pending Dues",
  ...lineTable(
    ["Invoice", "Customer", "Vehicle", "Due"],
    report.dueRows.slice(0, 15).map((row) => [row.invoiceNumber, row.customer, row.vehicle, formatMoney(row.balanceDue)]),
    [16, 28, 16, 16]
  ),
  "",
  "Low Stock Items",
  ...lineTable(
    ["Item", "Available", "Unit", "Alert"],
    report.lowStockRows.slice(0, 20).map((row) => [row.name, formatNumber(row.currentQuantity), row.unit, formatNumber(row.lowStockLevel)]),
    [38, 12, 10, 12]
  ),
  "",
  "Expiring Batches",
  ...lineTable(
    ["Item", "Batch", "Expiry", "Remaining"],
    report.expiringBatchRows.slice(0, 20).map((row) => [row.itemName, row.batchNumber, row.expiryDate, formatNumber(row.remainingQuantity)]),
    [34, 16, 12, 12]
  )
];

export function createDailyReportArchive(input: DailyReportArchiveInput): DailyReportArchiveResult {
  const report = buildDailyReport(input);
  const year = input.reportDate.slice(0, 4);
  const month = input.reportDate.slice(5, 7);
  const directory = path.join(input.outputRoot, "daily-reports", safeSegment(year, "year"), safeSegment(month, "month"));
  fs.mkdirSync(directory, { recursive: true });
  const fileName = `autocare24-daily-report-${safeSegment(input.reportDate, "report-date")}.zip`;
  const filePath = path.join(directory, fileName);

  const entries: ZipEntry[] = [
    { name: `autocare24-daily-report-${input.reportDate}.pdf`, data: createTextPdf(buildPdfLines(input, report)) },
    { name: "csv/sales-summary.csv", data: Buffer.from(rowsToCsv([report.salesSummary]), "utf8") },
    { name: "csv/invoices.csv", data: Buffer.from(rowsToCsv(report.invoiceRows), "utf8") },
    { name: "csv/payments.csv", data: Buffer.from(rowsToCsv(report.paymentRows), "utf8") },
    { name: "csv/pending-dues.csv", data: Buffer.from(rowsToCsv(report.dueRows), "utf8") },
    { name: "csv/dues-aging.csv", data: Buffer.from(rowsToCsv(report.duesAgingRows), "utf8") },
    { name: "csv/stock-summary.csv", data: Buffer.from(rowsToCsv([report.stockSummary]), "utf8") },
    { name: "csv/stock-items.csv", data: Buffer.from(rowsToCsv(report.stockItemRows), "utf8") },
    { name: "csv/low-stock-items.csv", data: Buffer.from(rowsToCsv(report.lowStockRows), "utf8") },
    { name: "csv/expiring-batches.csv", data: Buffer.from(rowsToCsv(report.expiringBatchRows), "utf8") },
    { name: "csv/stock-movements.csv", data: Buffer.from(rowsToCsv(report.stockMovementRows), "utf8") },
    { name: "raw/daily-report.json", data: jsonBuffer(report.raw) },
    { name: "raw/all-dues-snapshot.json", data: jsonBuffer(report.raw.allPendingDues) },
    { name: "raw/inventory-snapshot.json", data: jsonBuffer(input.inventory) }
  ];
  const manifest = {
    app: "Autocare24 Billing",
    format: "autocare24-daily-report-backup",
    version: 1,
    reportDate: input.reportDate,
    generatedAt: input.generatedAt,
    timezone: input.timezone,
    source: input.source,
    sourceDevice: input.sourceDevice,
    sourceStatus: input.sourceStatus,
    files: entries.map((entry) => ({
      name: entry.name,
      sizeBytes: entry.data.length,
      sha256: sha256(entry.data)
    }))
  };
  const zip = createZip([{ name: "manifest.json", data: jsonBuffer(manifest) }, ...entries]);
  fs.writeFileSync(filePath, zip);
  return {
    filePath,
    reportDate: input.reportDate,
    generatedAt: input.generatedAt,
    source: input.source,
    sizeBytes: zip.length
  };
}
