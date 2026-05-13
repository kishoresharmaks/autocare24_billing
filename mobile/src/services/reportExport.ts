import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import type {
  InventoryBatch,
  InventoryDashboardData,
  InventoryItem,
  InventoryMovement,
  InvoiceSummary,
  ProfitReportData,
  PurchaseRecord,
  ReportData,
  ReportDateFilter,
  Supplier
} from "../types/cloud";
import { formatCount, formatDate, formatDateTime, formatMoney, titleCase } from "../utils/format";

export type ExportFormat = "pdf" | "csv";
export type ReportCategoryId = "sales" | "gst" | "payments" | "stock" | "enquiries" | "jobCards" | "profit";

type ExportCell = string | number | undefined | null;
type ExportMetric = { label: string; value: string };
type ExportTable = { title: string; columns: string[]; rows: ExportCell[][]; emptyMessage?: string };
type ExportSection = { title: string; subtitle?: string; metrics?: ExportMetric[]; tables?: ExportTable[] };
type ExportDocument = { title: string; subtitle: string; fileBaseName: string; sections: ExportSection[] };
type StockBatch = InventoryBatch & { itemName?: string; unit?: string };

const A4_WIDTH = 595;
const A4_HEIGHT = 842;

export async function shareExportDocument(document: ExportDocument, format: ExportFormat) {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("Sharing is not available on this phone.");

  const fileName = `${safeFileName(document.fileBaseName)}-${timestampForFile()}.${format}`;
  const title = `${document.title} ${format.toUpperCase()}`;
  const uri = format === "pdf" ? await createPdfFile(document, fileName) : await createCsvFile(document, fileName);
  await Sharing.shareAsync(uri, {
    dialogTitle: `Share ${title}`,
    mimeType: format === "pdf" ? "application/pdf" : "text/csv",
    UTI: format === "pdf" ? "com.adobe.pdf" : "public.comma-separated-values-text"
  });
}

export async function exportReportsDocument(input: {
  report: ReportData;
  profit?: ProfitReportData;
  invoices: InvoiceSummary[];
  filter: ReportDateFilter;
  format: ExportFormat;
}) {
  const subtitle = input.report.rangeLabel || reportFilterLabel(input.filter);
  await shareExportDocument(
    {
      title: "Autocare24 Reports",
      subtitle,
      fileBaseName: `autocare24-reports-${reportFilterFilePart(subtitle)}`,
      sections: buildAllReportSections(input.report, input.invoices, input.filter, input.profit)
    },
    input.format
  );
}

export async function exportReportCategoryDocument(input: {
  category: ReportCategoryId;
  report: ReportData;
  profit?: ProfitReportData;
  invoices: InvoiceSummary[];
  filter: ReportDateFilter;
  format: ExportFormat;
}) {
  const title = reportCategoryTitle(input.category);
  const subtitle = input.category === "profit" ? input.profit?.rangeLabel || reportFilterLabel(input.filter) : input.report.rangeLabel || reportFilterLabel(input.filter);
  const sections = buildReportCategorySections(input.category, input.report, input.invoices, input.filter, input.profit);
  if (!sections.length) throw new Error(`${title} data is not loaded yet.`);
  await shareExportDocument(
    {
      title: `Autocare24 ${title}`,
      subtitle,
      fileBaseName: `autocare24-${safeFileName(title)}-${reportFilterFilePart(subtitle)}`,
      sections
    },
    input.format
  );
}

export async function exportProfitDocument(input: { profit: ProfitReportData; format: ExportFormat }) {
  await shareExportDocument(
    {
      title: "Autocare24 Profit Report",
      subtitle: input.profit.rangeLabel || "Selected period",
      fileBaseName: `autocare24-profit-report-${reportFilterFilePart(input.profit.rangeLabel || "period")}`,
      sections: buildProfitSections(input.profit)
    },
    input.format
  );
}

function buildAllReportSections(report: ReportData, invoices: InvoiceSummary[], filter: ReportDateFilter, profit?: ProfitReportData) {
  return [
    ...buildSalesSections(report, invoices, filter),
    ...buildGstSections(report),
    ...buildPaymentDuesSections(report),
    ...buildStockSections(report),
    ...buildEnquirySections(report),
    ...buildJobCardSections(report),
    ...(profit ? buildProfitSections(profit) : [])
  ];
}

function buildReportCategorySections(
  category: ReportCategoryId,
  report: ReportData,
  invoices: InvoiceSummary[],
  filter: ReportDateFilter,
  profit?: ProfitReportData
): ExportSection[] {
  if (category === "sales") return buildSalesSections(report, invoices, filter);
  if (category === "gst") return buildGstSections(report);
  if (category === "payments") return buildPaymentDuesSections(report);
  if (category === "stock") return buildStockSections(report);
  if (category === "enquiries") return buildEnquirySections(report);
  if (category === "jobCards") return buildJobCardSections(report);
  return profit ? buildProfitSections(profit) : [];
}

function reportCategoryTitle(category: ReportCategoryId) {
  const titles: Record<ReportCategoryId, string> = {
    sales: "Sales Report",
    gst: "GST / Tax Report",
    payments: "Payment & Dues Report",
    stock: "Stock Report",
    enquiries: "Enquiry Report",
    jobCards: "Job Card Report",
    profit: "Profit & Expense Report"
  };
  return titles[category];
}

function buildSalesSections(report: ReportData, invoices: InvoiceSummary[], filter: ReportDateFilter): ExportSection[] {
  const filteredInvoices = filterInvoicesByReportRange(invoices, filter);
  return [
    {
      title: "Sales Summary",
      metrics: [
        { label: "Billed value", value: formatMoney(report.revenue) },
        { label: "Collected", value: formatMoney(report.paidAmount) },
        { label: "Invoices", value: formatCount(report.invoiceCount) },
        { label: "Cancelled", value: formatCount(report.cancelledCount) }
      ]
    },
    {
      title: "Top Services / Items",
      tables: [
        {
          title: "Top Services",
          columns: ["Rank", "Service", "Quantity", "Revenue"],
          rows: (report.topServices || []).map((service, index) => [
            index + 1,
            service.name || "Unnamed service",
            formatCount(service.quantity),
            formatMoney(service.revenue)
          ]),
          emptyMessage: "No service rows in this range."
        }
      ]
    },
    {
      title: "Sales Invoice Details",
      tables: [
        {
          title: "Invoices",
          columns: ["Invoice", "Date", "Customer", "Phone", "Vehicle", "Total", "Paid", "Due", "Status"],
          rows: filteredInvoices.map((invoice) => invoiceRow(invoice)),
          emptyMessage: "No invoices in this range."
        }
      ]
    }
  ];
}

function buildGstSections(report: ReportData): ExportSection[] {
  return [
    {
      title: "GST / Tax",
      metrics: [
        { label: "Taxable value", value: formatMoney(report.taxableValue) },
        { label: "CGST", value: formatMoney(report.cgst) },
        { label: "SGST", value: formatMoney(report.sgst) },
        { label: "IGST", value: formatMoney(report.igst) },
        { label: "Total tax", value: formatMoney(report.totalTax) }
      ]
    }
  ];
}

function buildPaymentDuesSections(report: ReportData): ExportSection[] {
  return [
    {
      title: "Payment Modes",
      tables: [
        {
          title: "Collections",
          columns: ["Mode", "Amount"],
          rows: (report.paymentModes || []).map((mode) => [titleCase(mode.mode), formatMoney(mode.amount)]),
          emptyMessage: "No payments in this range."
        }
      ]
    },
    {
      title: "Pending Dues",
      metrics: [{ label: "Pending due", value: formatMoney(report.balanceDue) }],
      tables: [
        {
          title: "Due Invoices",
          columns: ["Invoice", "Date", "Customer", "Phone", "Vehicle", "Total", "Paid", "Due", "Status"],
          rows: (report.dues || []).map((invoice) => invoiceRow(invoice)),
          emptyMessage: "No pending dues."
        }
      ]
    }
  ];
}

function buildStockSections(report: ReportData): ExportSection[] {
  const inventory = report.inventory;
  const expiringBatches = inventory?.expiringBatches || [];
  const movements = inventory?.movements || inventory?.recentMovements || [];
  const emptySupplierMap = new Map<string, Supplier>();
  return [
    {
      title: "Inventory Snapshot",
      metrics: [
        { label: "Stock value", value: formatMoney(inventory?.totalStockValue) },
        { label: "Low stock", value: formatCount(inventory?.lowStockCount) },
        { label: "Expiring batches", value: formatCount(inventory?.expiringCount) },
        { label: "Retail products", value: formatCount(inventory?.retailCount) }
      ]
    },
    {
      title: "Stock Items",
      tables: [
        {
          title: "Items",
          columns: ["Name", "Type", "SKU", "Category", "Unit", "Qty", "Low Alert", "Value", "Status"],
          rows: (inventory?.items || []).map((item) => stockItemRow(item)),
          emptyMessage: "No stock items available."
        }
      ]
    },
    {
      title: "Low Stock Items",
      tables: [
        {
          title: "Low Stock",
          columns: ["Name", "Type", "SKU", "Category", "Unit", "Qty", "Low Alert", "Value", "Status"],
          rows: (inventory?.lowStockItems || []).map((item) => stockItemRow(item)),
          emptyMessage: "No low stock items."
        }
      ]
    },
    {
      title: "Expiring Batches",
      tables: [
        {
          title: "Expiring Batches",
          columns: ["Item", "Batch", "Bill", "Supplier", "Expiry", "Remaining", "Unit Cost", "Value"],
          rows: expiringBatches.map((batch) => stockBatchRow(batch, emptySupplierMap)),
          emptyMessage: "No expiring batches."
        }
      ]
    },
    {
      title: "Recent Stock Movements",
      tables: [
        {
          title: "Movements",
          columns: ["Date", "Item", "Type", "Qty", "Unit Cost", "Reference", "Notes"],
          rows: movements.map((movement) => [
            formatDate(movement.movementDate),
            movement.itemName,
            titleCase(movement.type),
            `${formatCount(movement.quantity)} ${movement.itemUnit || "unit"}`,
            formatMoney(movement.unitCost),
            movement.reference,
            movement.notes
          ]),
          emptyMessage: "No stock movements available."
        }
      ]
    }
  ];
}

function buildEnquirySections(report: ReportData): ExportSection[] {
  return [
    {
      title: "Enquiries",
      metrics: [
        { label: "Total", value: formatCount(report.enquiries?.total) },
        { label: "Open", value: formatCount(report.enquiries?.open) },
        { label: "Converted", value: formatCount(report.enquiries?.converted) },
        { label: "Lost", value: formatCount(report.enquiries?.lost) }
      ],
      tables: [
        {
          title: "Status Breakdown",
          columns: ["Status", "Count"],
          rows: (report.enquiries?.byStatus || []).map((row) => [titleCase(row.status), formatCount(row.count)]),
          emptyMessage: "No enquiry status data."
        },
        {
          title: "Source Breakdown",
          columns: ["Source", "Count"],
          rows: (report.enquiries?.bySource || []).map((row) => [titleCase(row.source || "Unknown"), formatCount(row.count)]),
          emptyMessage: "No enquiry source data."
        }
      ]
    }
  ];
}

function buildJobCardSections(report: ReportData): ExportSection[] {
  return [
    {
      title: "Job Cards",
      metrics: [
        { label: "Total", value: formatCount(report.jobCards?.total) },
        { label: "Open", value: formatCount(report.jobCards?.open) },
        { label: "In progress", value: formatCount(report.jobCards?.inProgress) },
        { label: "Completed", value: formatCount(report.jobCards?.completed) },
        { label: "Approval pending", value: formatCount(report.jobCards?.approvalPending) },
        { label: "Billed", value: formatCount(report.jobCards?.billed) },
        { label: "Cancelled", value: formatCount(report.jobCards?.cancelled) },
        { label: "Billed revenue", value: formatMoney(report.jobCards?.billedRevenue) },
        { label: "Avg. turnaround", value: `${formatCount(report.jobCards?.averageTurnaroundDays)} day(s)` }
      ],
      tables: [
        {
          title: "Status Breakdown",
          columns: ["Status", "Count"],
          rows: (report.jobCards?.byStatus || []).map((row) => [titleCase(row.status), formatCount(row.count)]),
          emptyMessage: "No job-card status data."
        }
      ]
    }
  ];
}

function buildProfitSections(profit: ProfitReportData): ExportSection[] {
  return [
    {
      title: "Profit Summary",
      metrics: [
        { label: "Cash profit", value: formatMoney(profit.cashProfit) },
        { label: "Profit margin", value: `${Number(profit.profitMargin || 0).toFixed(2)}%` },
        { label: "Paid revenue", value: formatMoney(profit.paidRevenue) },
        { label: "Stock cost", value: formatMoney(profit.stockCost) },
        { label: "Expenses", value: formatMoney(profit.expenseTotal) }
      ]
    },
    {
      title: "Expense Categories",
      tables: [
        {
          title: "By Category",
          columns: ["Category", "Amount"],
          rows: (profit.expensesByCategory || []).map((category) => [category.category || "Other", formatMoney(category.amount)]),
          emptyMessage: "No expenses in this range."
        }
      ]
    },
    {
      title: "Recent Expenses",
      tables: [
        {
          title: "Expenses",
          columns: ["Date", "Category", "Vendor", "Mode", "Reference", "Amount", "Notes"],
          rows: (profit.expenses || []).map((expense) => [
            formatDate(expense.expenseDate),
            expense.category,
            expense.vendor,
            titleCase(expense.paymentMode),
            expense.reference,
            formatMoney(expense.amount),
            expense.notes
          ]),
          emptyMessage: "No expense records in this range."
        }
      ]
    },
    {
      title: "Profit Trend",
      tables: [
        {
          title: "Trend",
          columns: ["Date", "Paid Revenue", "Stock Cost", "Expenses", "Cash Profit"],
          rows: (profit.trend || []).map((row) => [
            row.date || row.label,
            formatMoney(row.paidRevenue),
            formatMoney(row.stockCost),
            formatMoney(row.expenses),
            formatMoney(row.cashProfit)
          ]),
          emptyMessage: "No trend rows available."
        }
      ]
    }
  ];
}

export async function exportStockDocument(input: {
  dashboard: InventoryDashboardData;
  suppliers: Supplier[];
  purchaseRecords: PurchaseRecord[];
  format: ExportFormat;
}) {
  const batches = input.dashboard.batches || input.dashboard.expiringBatches || [];
  const movements = input.dashboard.movements || input.dashboard.recentMovements || [];
  const supplierMap = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]));

  await shareExportDocument(
    {
      title: "Autocare24 Stock Report",
      subtitle: "Current inventory snapshot",
      fileBaseName: "autocare24-stock-report",
      sections: [
        {
          title: "Stock Summary",
          metrics: [
            { label: "Stock value", value: formatMoney(input.dashboard.totalStockValue) },
            { label: "Low stock", value: formatCount(input.dashboard.lowStockCount) },
            { label: "Expiring batches", value: formatCount(input.dashboard.expiringCount) },
            { label: "Retail products", value: formatCount(input.dashboard.retailCount) },
            { label: "Suppliers/vendors", value: formatCount(input.suppliers.length) },
            { label: "Purchase records", value: formatCount(input.purchaseRecords.length) }
          ]
        },
        {
          title: "Stock Items",
          tables: [
            {
              title: "Items",
              columns: ["Name", "Type", "SKU", "Category", "Unit", "Qty", "Low Alert", "Value", "Status"],
              rows: (input.dashboard.items || []).map((item) => stockItemRow(item)),
              emptyMessage: "No stock items available."
            }
          ]
        },
        {
          title: "Low Stock Items",
          tables: [
            {
              title: "Low Stock",
              columns: ["Name", "Type", "SKU", "Category", "Unit", "Qty", "Low Alert", "Value", "Status"],
              rows: (input.dashboard.lowStockItems || []).map((item) => stockItemRow(item)),
              emptyMessage: "No low stock items."
            }
          ]
        },
        {
          title: "Expiring Batches",
          tables: [
            {
              title: "Expiring Batches",
              columns: ["Item", "Batch", "Bill", "Supplier", "Expiry", "Remaining", "Unit Cost", "Value"],
              rows: (input.dashboard.expiringBatches || []).map((batch) => stockBatchRow(batch, supplierMap)),
              emptyMessage: "No expiring batches."
            }
          ]
        },
        {
          title: "Recent Stock Movements",
          tables: [
            {
              title: "Movements",
              columns: ["Date", "Item", "Type", "Qty", "Unit Cost", "Reference", "Notes"],
              rows: movements.map((movement) => [
                formatDate(movement.movementDate),
                movement.itemName,
                titleCase(movement.type),
                `${formatCount(movement.quantity)} ${movement.itemUnit || "unit"}`,
                formatMoney(movement.unitCost),
                movement.reference,
                movement.notes
              ]),
              emptyMessage: "No stock movements available."
            }
          ]
        },
        {
          title: "Suppliers / Vendors",
          tables: [
            {
              title: "Suppliers",
              columns: ["Name", "Phone", "GSTIN", "Address"],
              rows: input.suppliers.map((supplier) => [supplier.name, supplier.phone, supplier.gstin, supplier.address]),
              emptyMessage: "No suppliers available."
            }
          ]
        },
        {
          title: "Purchase Records",
          tables: [
            {
              title: "Purchase Records",
              columns: ["Date", "Vendor", "Bill", "Amount", "Mode", "Documents", "Notes"],
              rows: input.purchaseRecords.map((record) => [
                formatDate(record.purchaseDate),
                record.supplierName || record.vendorName,
                record.billNumber,
                formatMoney(record.amount),
                titleCase(record.paymentMode),
                formatCount(Array.isArray(record.documents) ? record.documents.length : 0),
                record.notes
              ]),
              emptyMessage: "No purchase records available."
            }
          ]
        }
      ]
    },
    input.format
  );
}

export async function exportInvoicesDocument(input: { invoices: InvoiceSummary[]; query: string; totals: { count: number; total: number; balance: number; cancelled: number }; format: ExportFormat }) {
  const subtitle = input.query.trim() ? `Search: ${input.query.trim()}` : "Current invoice list";
  await shareExportDocument(
    {
      title: "Autocare24 Invoice List",
      subtitle,
      fileBaseName: input.query.trim() ? `autocare24-invoices-${reportFilterFilePart(input.query)}` : "autocare24-invoices",
      sections: [
        {
          title: "Invoice Summary",
          metrics: [
            { label: "Invoices", value: formatCount(input.totals.count) },
            { label: "Total value", value: formatMoney(input.totals.total) },
            { label: "Balance due", value: formatMoney(input.totals.balance) },
            { label: "Cancelled", value: formatCount(input.totals.cancelled) }
          ]
        },
        {
          title: "Invoices",
          tables: [
            {
              title: "Current List",
              columns: ["Invoice", "Date", "Customer", "Phone", "Vehicle", "Total", "Paid", "Due", "Status"],
              rows: input.invoices.map((invoice) => invoiceRow(invoice)),
              emptyMessage: "No invoices found."
            }
          ]
        }
      ]
    },
    input.format
  );
}

async function createCsvFile(document: ExportDocument, fileName: string) {
  const uri = exportFileUri(fileName);
  await FileSystem.deleteAsync(uri, { idempotent: true });
  await FileSystem.writeAsStringAsync(uri, buildCsv(document), { encoding: FileSystem.EncodingType.UTF8 });
  return uri;
}

async function createPdfFile(document: ExportDocument, fileName: string) {
  const result = await Print.printToFileAsync({
    html: buildHtml(document),
    width: A4_WIDTH,
    height: A4_HEIGHT,
    margins: { top: 24, right: 20, bottom: 24, left: 20 }
  });
  const targetUri = exportFileUri(fileName);
  await FileSystem.deleteAsync(targetUri, { idempotent: true });
  await FileSystem.copyAsync({ from: result.uri, to: targetUri });
  return targetUri;
}

function exportFileUri(fileName: string) {
  const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!directory) throw new Error("File storage is not available on this phone.");
  return `${directory}${fileName}`;
}

function buildHtml(document: ExportDocument) {
  const generated = formatDateTime(new Date().toISOString());
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; color: #302d45; font-family: Arial, sans-serif; font-size: 11px; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    h2 { margin: 22px 0 8px; font-size: 16px; color: #352f65; }
    h3 { margin: 14px 0 6px; font-size: 12px; color: #5a3fd5; }
    .sub { color: #777486; font-weight: 700; }
    .header { border-bottom: 2px solid #5a3fd5; padding-bottom: 12px; margin-bottom: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 10px; }
    .metric { border: 1px solid #e3e1ee; border-radius: 8px; padding: 8px; background: #f7f9ff; }
    .metric span { display: block; color: #777486; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 4px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; page-break-inside: auto; }
    th, td { border: 1px solid #e3e1ee; padding: 5px; text-align: left; vertical-align: top; }
    th { background: #f2efff; color: #352f65; font-size: 10px; text-transform: uppercase; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    .empty { border: 1px dashed #e3e1ee; border-radius: 8px; padding: 10px; color: #777486; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(document.title)}</h1>
    <div class="sub">${escapeHtml(document.subtitle)}</div>
    <div class="sub">Generated: ${escapeHtml(generated)}</div>
  </div>
  ${document.sections.map(sectionHtml).join("")}
</body>
</html>`;
}

function sectionHtml(section: ExportSection) {
  return `<section>
    <h2>${escapeHtml(section.title)}</h2>
    ${section.subtitle ? `<div class="sub">${escapeHtml(section.subtitle)}</div>` : ""}
    ${section.metrics?.length ? `<div class="metrics">${section.metrics.map((metric) => `<div class="metric"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join("")}</div>` : ""}
    ${(section.tables || []).map(tableHtml).join("")}
  </section>`;
}

function tableHtml(table: ExportTable) {
  if (!table.rows.length) return `<h3>${escapeHtml(table.title)}</h3><div class="empty">${escapeHtml(table.emptyMessage || "No records available.")}</div>`;
  return `<h3>${escapeHtml(table.title)}</h3><table><thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${table.rows
    .map((row) => `<tr>${table.columns.map((_, index) => `<td>${escapeHtml(row[index])}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function buildCsv(document: ExportDocument) {
  const lines: string[] = [
    csvRow([document.title]),
    csvRow(["Period", document.subtitle]),
    csvRow(["Generated", formatDateTime(new Date().toISOString())]),
    ""
  ];

  document.sections.forEach((section) => {
    lines.push(csvRow([section.title]));
    if (section.subtitle) lines.push(csvRow(["Note", section.subtitle]));
    (section.metrics || []).forEach((metric) => lines.push(csvRow([metric.label, metric.value])));
    if (section.metrics?.length) lines.push("");
    (section.tables || []).forEach((table) => {
      lines.push(csvRow([table.title]));
      lines.push(csvRow(table.columns));
      if (table.rows.length) {
        table.rows.forEach((row) => lines.push(csvRow(table.columns.map((_, index) => row[index]))));
      } else {
        lines.push(csvRow([table.emptyMessage || "No records available."]));
      }
      lines.push("");
    });
    lines.push("");
  });
  return lines.join("\n");
}

function csvRow(values: ExportCell[]) {
  return values.map((value) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",");
}

function invoiceRow(invoice: InvoiceSummary): ExportCell[] {
  return [
    invoice.invoiceNumber,
    formatDate(invoice.invoiceDate || invoice.createdAt),
    invoice.customerName,
    invoice.customerPhone,
    invoice.vehicleNumber,
    formatMoney(invoice.grandTotal),
    formatMoney(invoice.paidAmount),
    formatMoney(invoice.balanceDue),
    titleCase(invoice.invoiceStatus || invoice.paymentStatus)
  ];
}

function stockItemRow(item: InventoryItem): ExportCell[] {
  const status = item.active === false ? "Inactive" : Number(item.lowStockLevel || 0) > 0 && Number(item.currentQuantity || 0) <= Number(item.lowStockLevel || 0) ? "Low stock" : "Active";
  return [
    item.name,
    titleCase(item.type),
    item.sku,
    item.category,
    item.unit,
    formatCount(item.currentQuantity),
    formatCount(item.lowStockLevel),
    formatMoney(item.stockValue),
    status
  ];
}

function stockBatchRow(batch: StockBatch, supplierMap: Map<string, Supplier>): ExportCell[] {
  const value = Number(batch.quantityRemaining || 0) * Number(batch.unitCost || 0);
  return [
    batch.itemName || batch.itemId,
    batch.batchNumber,
    batch.billNumber,
    supplierMap.get(batch.supplierId)?.name || "",
    formatDate(batch.expiryDate),
    `${formatCount(batch.quantityRemaining)} ${batch.unit || "unit"}`,
    formatMoney(batch.unitCost),
    formatMoney(value)
  ];
}

function filterInvoicesByReportRange(invoices: InvoiceSummary[], filter: ReportDateFilter) {
  if (typeof filter === "string") {
    if (filter === "all") return invoices;
    const days = filter === "90d" ? 90 : filter === "7d" ? 7 : 30;
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    return filterInvoicesBetween(invoices, toIsoDate(from), "");
  }
  return filterInvoicesBetween(invoices, filter.fromDate || "", filter.toDate || "");
}

function filterInvoicesBetween(invoices: InvoiceSummary[], fromDate: string, toDate: string) {
  return invoices.filter((invoice) => {
    const date = String(invoice.invoiceDate || invoice.createdAt || "").slice(0, 10);
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;
    return true;
  });
}

function reportFilterLabel(filter: ReportDateFilter) {
  if (typeof filter === "string") return filter === "all" ? "All time" : `Last ${filter.replace("d", " days")}`;
  if (filter.fromDate && filter.toDate) return `${filter.fromDate} to ${filter.toDate}`;
  if (filter.fromDate) return `From ${filter.fromDate}`;
  if (filter.toDate) return `Until ${filter.toDate}`;
  return "Selected period";
}

function reportFilterFilePart(value: string) {
  return safeFileName(value || "report");
}

function safeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/rs\.?\s*/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "autocare24-report";
}

function timestampForFile() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
}

function toIsoDate(date: Date) {
  const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return normalized.toISOString().slice(0, 10);
}

function escapeHtml(value: ExportCell) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
