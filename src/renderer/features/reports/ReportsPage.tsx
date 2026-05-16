import { Archive, CalendarDays, Download, FileSpreadsheet, FileText, FolderOpen, HardDriveUpload, Printer, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppUser,
  DateRangePreset,
  DailyReportBackupStatus,
  Expense,
  ExpenseInput,
  InventoryItem,
  InventoryMovement,
  PaymentMode,
  ProfitReportData,
  ReportData,
  ReportDateFilter,
  ReportExportKind
} from "../../../shared/types";
import { hasPermission } from "../../../shared/access-control";
import { InvoiceTable } from "../../components/tables/InvoiceTable";
import { emptyExpenseInput } from "./ProfitReportView";

type LegacyReportView = "all" | "billing" | "stock" | "enquiries" | "profit";
type ReportTab = "summary" | "sales" | "gst" | "payments" | "stock" | "enquiries" | "jobCards" | "profit";
type ChartPoint = { label: string; [key: string]: string | number };
type ReportTabConfig = { id: ReportTab; label: string; exportKind: ReportExportKind };

const presets: DateRangePreset[] = ["7d", "30d", "90d", "all"];
const paymentModes: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const defaultReportTab: ReportTabConfig = { id: "summary", label: "Full Business Summary", exportKind: "full" };
const reportTabs: ReportTabConfig[] = [
  defaultReportTab,
  { id: "sales", label: "Sales Report", exportKind: "sales" },
  { id: "gst", label: "GST / Tax Report", exportKind: "gst" },
  { id: "payments", label: "Payment & Dues", exportKind: "payments" },
  { id: "stock", label: "Stock Report", exportKind: "stock" },
  { id: "enquiries", label: "Enquiry Report", exportKind: "enquiries" },
  { id: "jobCards", label: "Job Card Report", exportKind: "jobCards" },
  { id: "profit", label: "Profit & Expense", exportKind: "profit" }
];

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const percent = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
const legacyToTab = (view?: LegacyReportView): ReportTab =>
  view === "stock" ? "stock" : view === "enquiries" ? "enquiries" : view === "profit" ? "profit" : view === "billing" ? "sales" : "summary";
const reportExportLabel = (kind: ReportExportKind) =>
  kind === "full" ? "full-business-summary" : kind === "jobCards" ? "job-card-report" : `${kind}-report`;
const safeFilePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/rs\s*/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";
const timestampFilePart = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
};
const reportFileName = (kind: ReportExportKind, rangeLabel: string, extension: "pdf" | "csv") =>
  `autocare24-${reportExportLabel(kind)}-${safeFilePart(rangeLabel)}-${timestampFilePart()}.${extension}`;
const formatDateTime = (value: string) => value ? new Date(value).toLocaleString() : "Not generated yet";

export function ReportsPage({
  refreshKey,
  notify,
  currentUser,
  view
}: {
  refreshKey: number;
  notify: (message: string) => void;
  currentUser: AppUser;
  view?: LegacyReportView;
}) {
  const [activeTab, setActiveTab] = useState<ReportTab>(() => legacyToTab(view));
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [profit, setProfit] = useState<ProfitReportData | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseInput>(() => emptyExpenseInput());
  const [savingExpense, setSavingExpense] = useState(false);
  const [busyExport, setBusyExport] = useState("");
  const [busyPdf, setBusyPdf] = useState(false);
  const [dailyReportStatus, setDailyReportStatus] = useState<DailyReportBackupStatus | null>(null);
  const [busyDailyReport, setBusyDailyReport] = useState(false);

  const filter = useMemo<ReportDateFilter>(() => {
    if (fromDate || toDate) return { preset, fromDate, toDate };
    return { preset };
  }, [preset, fromDate, toDate]);

  const loadReports = async () => {
    if (!hasPermission(currentUser, "reports.view")) return;
    try {
      const [nextReport, nextProfit] = await Promise.all([window.autocare.reports(filter), window.autocare.profit(filter)]);
      setReport(nextReport);
      setProfit(nextProfit);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load reports.");
    }
  };

  const loadDailyReportStatus = async () => {
    if (!hasPermission(currentUser, "reports.export")) return;
    try {
      setDailyReportStatus(await window.autocare.dailyReportBackupStatus());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load daily report backup status.");
    }
  };

  useEffect(() => {
    setReport(null);
    setProfit(null);
    void loadReports();
    void loadDailyReportStatus();
  }, [refreshKey, currentUser.id, currentUser.permissions.join("|"), filter]);

  if (!hasPermission(currentUser, "reports.view")) {
    return (
      <div className="page-grid">
        <section className="panel wide-panel access-panel">
          <h2>Owner access required</h2>
          <p className="muted">Reports are protected because they include revenue, dues, expenses, and profit details.</p>
        </section>
      </div>
    );
  }

  if (!report || !profit) return <div className="empty-state">Loading report dashboard...</div>;

  const active = reportTabs.find((item) => item.id === activeTab) || defaultReportTab;
  const conversionRate = report.enquiries.total ? Math.round((report.enquiries.converted / report.enquiries.total) * 100) : 0;

  const exportReport = async (kind: ReportExportKind) => {
    if (!hasPermission(currentUser, "reports.export")) return notify("Report export access is not enabled for this role.");
    setBusyExport(kind);
    try {
      const result = await window.autocare.exportReportCsv({ kind, filter, fileName: reportFileName(kind, report.rangeLabel, "csv") });
      notify(result.path ? `${result.message} ${result.path}` : result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to export report.");
    } finally {
      setBusyExport("");
    }
  };

  const printReport = async () => {
    try {
      await window.autocare.print({ pageSize: "A4", requiredPermission: "reports.export" });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to print report.");
    }
  };

  const saveReportPdf = async () => {
    setBusyPdf(true);
    try {
      const result = await window.autocare.savePdf({
        title: "Save report PDF",
        defaultFileName: reportFileName(active.exportKind, report.rangeLabel, "pdf"),
        pageSize: "A4",
        requiredPermission: "reports.export",
        successMessage: "Report PDF saved successfully."
      });
      notify(result.path ? `${result.message} ${result.path}` : result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save report PDF.");
    } finally {
      setBusyPdf(false);
    }
  };

  const generateDailyReportBackup = async () => {
    if (!hasPermission(currentUser, "reports.export")) return notify("Report export access is not enabled for this role.");
    setBusyDailyReport(true);
    try {
      const result = await window.autocare.generateDailyReportBackup();
      notify(result.path ? `${result.message} ${result.path}` : result.message);
      await loadDailyReportStatus();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to generate daily report backup.");
    } finally {
      setBusyDailyReport(false);
    }
  };

  const openDailyReportBackupFolder = async () => {
    try {
      const result = await window.autocare.openDailyReportBackupFolder();
      notify(result.path ? `${result.message} ${result.path}` : result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to open daily report backup folder.");
    }
  };

  const saveExpense = async () => {
    if (!hasPermission(currentUser, "expenses.manage")) return notify("Expense access is not enabled for this role.");
    setSavingExpense(true);
    try {
      await window.autocare.saveExpense(expenseForm);
      setExpenseForm(emptyExpenseInput());
      setProfit(await window.autocare.profit(filter));
      notify("Expense saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save expense.");
    } finally {
      setSavingExpense(false);
    }
  };

  const deleteExpense = async (expense: Expense) => {
    if (!hasPermission(currentUser, "expenses.manage")) return notify("Expense access is not enabled for this role.");
    if (!window.confirm(`Delete expense ${expense.category} - ${formatMoney(expense.amount)}?`)) return;
    try {
      await window.autocare.deleteExpense(expense.id);
      setProfit(await window.autocare.profit(filter));
      notify("Expense deleted.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to delete expense.");
    }
  };

  return (
    <div className="reports-workspace">
      <section className="reports-toolbar no-print">
        <div>
          <span className="eyebrow">Owner reports</span>
          <h2>Reports</h2>
          <p>{report.rangeLabel}</p>
        </div>
        <div className="report-actions">
          <button className="ghost-button" onClick={() => void loadReports()}><RefreshCw size={17} /> Refresh</button>
        </div>
      </section>

      {hasPermission(currentUser, "reports.export") && <section className="report-export-panel no-print" aria-label="Report export actions">
        <div className="report-export-summary">
          <strong>{active.label}</strong>
          <span>{report.rangeLabel}</span>
        </div>
        <div className="report-export-options">
          <div className="report-export-option">
            <FileText size={19} />
            <div>
              <strong>PDF report</strong>
              <span>Print-ready view with charts, KPIs, and tables.</span>
            </div>
            <button className="ghost-button" onClick={() => void printReport()}><Printer size={17} /> Print</button>
            <button className="primary-action" disabled={busyPdf} onClick={() => void saveReportPdf()}>
              <FileText size={17} /> {busyPdf ? "Saving..." : "Save PDF"}
            </button>
          </div>
          <div className="report-export-option">
            <FileSpreadsheet size={19} />
            <div>
              <strong>Excel data</strong>
              <span>Structured CSV that opens cleanly in Excel.</span>
            </div>
            <button className="ghost-button" disabled={Boolean(busyExport)} onClick={() => void exportReport(active.exportKind)}>
              <Download size={17} /> {busyExport === active.exportKind ? "Exporting..." : "Current report"}
            </button>
            <button className="primary-action" disabled={Boolean(busyExport)} onClick={() => void exportReport("full")}>
              <Download size={17} /> {busyExport === "full" ? "Exporting..." : "Full bundle"}
            </button>
          </div>
        </div>
      </section>}

      {hasPermission(currentUser, "reports.export") && <section className="daily-report-backup-panel no-print" aria-label="Daily report backup">
        <div className="daily-report-backup-header">
          <div>
            <span className="eyebrow">Daily backup archive</span>
            <h3>Sales, stock, and pending dues</h3>
            <p>Creates one permanent zip per day with PDF, CSV files, raw JSON, and file hashes.</p>
          </div>
          <Archive size={22} />
        </div>
        <div className="daily-report-backup-grid">
          <div className="daily-report-backup-item">
            <span>Last report</span>
            <strong>{formatDateTime(dailyReportStatus?.lastReportAt || "")}</strong>
            <small>{dailyReportStatus?.lastReportDate || "No daily archive found"}</small>
          </div>
          <div className="daily-report-backup-item">
            <span>Next automatic run</span>
            <strong>{formatDateTime(dailyReportStatus?.nextRunAt || "")}</strong>
            <small>{dailyReportStatus?.scheduledTime || "Uses backup schedule"}</small>
          </div>
          <div className="daily-report-backup-item">
            <span>Google Drive</span>
            <strong>{dailyReportStatus?.lastDriveUploadAt ? "Uploaded" : "Not uploaded yet"}</strong>
            <small>{dailyReportStatus?.lastDriveUploadName || "Uploads when Drive is connected"}</small>
          </div>
        </div>
        {dailyReportStatus?.lastError && <div className="daily-report-backup-warning">{dailyReportStatus.lastError}</div>}
        <div className="daily-report-backup-actions">
          <button className="primary-action" disabled={busyDailyReport} onClick={() => void generateDailyReportBackup()}>
            <HardDriveUpload size={17} /> {busyDailyReport ? "Generating..." : "Generate Now"}
          </button>
          <button className="ghost-button" onClick={() => void openDailyReportBackupFolder()}>
            <FolderOpen size={17} /> Open Folder
          </button>
        </div>
      </section>}

      <section className="report-filter-panel no-print">
        <div className="segmented">
          {presets.map((item) => (
            <button
              key={item}
              className={!fromDate && !toDate && preset === item ? "active" : ""}
              onClick={() => {
                setPreset(item);
                setFromDate("");
                setToDate("");
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="report-date-filters">
          <label><CalendarDays size={16} /> From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.currentTarget.value)} /></label>
          <label><CalendarDays size={16} /> To<input type="date" value={toDate} onChange={(event) => setToDate(event.currentTarget.value)} /></label>
          {(fromDate || toDate) && <button className="ghost-button small" onClick={() => { setFromDate(""); setToDate(""); }}>Clear custom</button>}
        </div>
      </section>

      <nav className="report-tabs no-print" aria-label="Report sections">
        {reportTabs.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="report-print-header print-only">
        <div>
          <span>Autocare24 Billing</span>
          <h1>{active.label}</h1>
          <p>{report.rangeLabel}</p>
        </div>
        <div>
          <strong>Generated</strong>
          <span>{new Date().toLocaleString()}</span>
        </div>
      </section>

      {(activeTab === "summary" || activeTab === "sales") && (
        <SalesReport report={report} profit={profit} conversionRate={conversionRate} summary={activeTab === "summary"} />
      )}
      {activeTab === "gst" && <GstReport report={report} />}
      {activeTab === "payments" && <PaymentsReport report={report} />}
      {activeTab === "stock" && <StockReport report={report} />}
      {activeTab === "enquiries" && <EnquiryReport report={report} conversionRate={conversionRate} />}
      {activeTab === "jobCards" && <JobCardReport report={report} />}
      {activeTab === "profit" && (
        <ProfitExpenseReport
          profit={profit}
          expenseForm={hasPermission(currentUser, "expenses.manage") ? expenseForm : undefined}
          setExpenseForm={hasPermission(currentUser, "expenses.manage") ? setExpenseForm : undefined}
          savingExpense={savingExpense}
          saveExpense={hasPermission(currentUser, "expenses.manage") ? saveExpense : undefined}
          deleteExpense={hasPermission(currentUser, "expenses.manage") ? deleteExpense : undefined}
        />
      )}
    </div>
  );
}

function SalesReport({
  report,
  profit,
  conversionRate,
  summary
}: {
  report: ReportData;
  profit: ProfitReportData;
  conversionRate: number;
  summary?: boolean;
}) {
  const invoiceRevenue = report.invoiceRevenue ?? report.revenue;
  const quickStockSales = report.quickStockSales ?? 0;
  const totalSales = report.totalSales ?? money(invoiceRevenue + quickStockSales);
  return (
    <div className="report-grid">
      <div className="metric-strip">
        <Metric label="Invoice billed" value={formatMoney(invoiceRevenue)} />
        <Metric label="Quick stock sales" value={formatMoney(quickStockSales)} tone={quickStockSales ? "ok" : undefined} />
        <Metric label="Total sales" value={formatMoney(totalSales)} />
        <Metric label="Collected" value={formatMoney(report.paidAmount)} tone="ok" />
        <Metric label="Pending due" value={formatMoney(report.balanceDue)} tone={report.balanceDue ? "warn" : "ok"} />
        <Metric label="Invoices" value={String(report.invoiceCount)} />
        {summary && <Metric label="Cash profit" value={formatMoney(profit.cashProfit)} tone={profit.cashProfit >= 0 ? "ok" : "warn"} />}
        {summary && <Metric label="Lead conversion" value={`${conversionRate}%`} tone={conversionRate > 0 ? "ok" : undefined} />}
      </div>

      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Daily sales trend</h2>
            <p>Collected payments and total sales by date.</p>
          </div>
        </div>
        <LineAreaChart
          points={report.salesTrend}
          primaryKey="paidAmount"
          secondaryKey="totalSales"
          primaryLabel="Collected"
          secondaryLabel="Total sales"
        />
      </section>

      <section className="panel">
        <h2>Invoice sales, quick sales, due</h2>
        <HorizontalBars
          rows={[
            { label: "Invoice billed", value: invoiceRevenue },
            { label: "Quick stock sales", value: quickStockSales },
            { label: "Total sales", value: totalSales },
            { label: "Collected", value: report.paidAmount },
            { label: "Due", value: report.balanceDue, tone: "warn" }
          ]}
        />
      </section>

      <section className="panel">
        <h2>Top services</h2>
        <HorizontalBars rows={report.topServices.map((item) => ({ label: item.name, value: item.revenue, hint: `${item.quantity} qty` }))} />
      </section>

      {summary && (
        <>
          <GstReport report={report} compact />
          <StockReport report={report} compact />
          <EnquiryReport report={report} conversionRate={conversionRate} compact />
          <JobCardReport report={report} compact />
          <ProfitExpenseReport profit={profit} compact />
        </>
      )}
    </div>
  );
}

function GstReport({ report, compact }: { report: ReportData; compact?: boolean }) {
  return (
    <section className={compact ? "panel" : "report-grid"}>
      {!compact && (
        <div className="metric-strip">
          <Metric label="Taxable value" value={formatMoney(report.taxableValue)} />
          <Metric label="CGST" value={formatMoney(report.cgst)} />
          <Metric label="SGST" value={formatMoney(report.sgst)} />
          <Metric label="IGST" value={formatMoney(report.igst)} />
          <Metric label="Total tax" value={formatMoney(report.totalTax)} />
        </div>
      )}
      <div className={compact ? "" : "panel wide-panel"}>
        <h2>GST / tax breakdown</h2>
        <HorizontalBars
          rows={[
            { label: "Taxable value", value: report.taxableValue },
            { label: "CGST", value: report.cgst },
            { label: "SGST", value: report.sgst },
            { label: "IGST", value: report.igst },
            { label: "Total tax", value: report.totalTax }
          ]}
        />
      </div>
    </section>
  );
}

function PaymentsReport({ report }: { report: ReportData }) {
  return (
    <div className="report-grid">
      <div className="metric-strip">
        <Metric label="Collected" value={formatMoney(report.paidAmount)} tone="ok" />
        <Metric label="Pending due" value={formatMoney(report.balanceDue)} tone={report.balanceDue ? "warn" : "ok"} />
        <Metric label="Payment modes" value={String(report.paymentModes.length)} />
        <Metric label="Due invoices" value={String(report.dues.length)} tone={report.dues.length ? "warn" : "ok"} />
      </div>
      <section className="panel">
        <h2>Payment mode collection</h2>
        <HorizontalBars rows={report.paymentModes.map((item) => ({ label: item.mode, value: item.amount }))} />
      </section>
      <section className="panel wide-panel">
        <h2>Pending dues</h2>
        <InvoiceTable invoices={report.dues} compact />
      </section>
    </div>
  );
}

function StockReport({ report, compact }: { report: ReportData; compact?: boolean }) {
  const consumables = report.inventory.items.filter((item) => item.type === "consumable");
  const retail = report.inventory.items.filter((item) => item.type === "retail");
  const typeRows = [
    { label: "Studio consumables", value: stockValue(consumables), hint: `${activeStockCount(consumables)} items` },
    { label: "Retail products", value: stockValue(retail), hint: `${activeStockCount(retail)} items` }
  ];

  if (compact) {
    return (
      <section className="panel">
        <h2>Stock snapshot</h2>
        <div className="summary-rows">
          <Row label="Stock value" value={formatMoney(report.inventory.totalStockValue)} />
          <Row label="Low stock" value={String(report.inventory.lowStockCount)} />
          <Row label="Expiring batches" value={String(report.inventory.expiringCount)} />
        </div>
      </section>
    );
  }

  return (
    <div className="report-grid">
      <div className="metric-strip">
        <Metric label="Stock value" value={formatMoney(report.inventory.totalStockValue)} />
        <Metric label="Low stock" value={String(report.inventory.lowStockCount)} tone={report.inventory.lowStockCount ? "warn" : "ok"} />
        <Metric label="Expiring batches" value={String(report.inventory.expiringCount)} tone={report.inventory.expiringCount ? "warn" : "ok"} />
        <Metric label="Retail products" value={String(report.inventory.retailCount)} />
      </div>
      <section className="panel">
        <h2>Stock type value</h2>
        <HorizontalBars rows={typeRows} />
      </section>
      <section className="panel">
        <h2>Low stock</h2>
        <InventoryItemList items={report.inventory.lowStockItems} />
      </section>
      <section className="panel wide-panel">
        <h2>Recent stock movements</h2>
        <InventoryMovementTable movements={report.inventory.recentMovements} />
      </section>
    </div>
  );
}

function EnquiryReport({ report, conversionRate, compact }: { report: ReportData; conversionRate: number; compact?: boolean }) {
  if (compact) {
    return (
      <section className="panel">
        <h2>Enquiry snapshot</h2>
        <div className="summary-rows">
          <Row label="Total leads" value={String(report.enquiries.total)} />
          <Row label="Converted" value={String(report.enquiries.converted)} />
          <Row label="Conversion rate" value={`${conversionRate}%`} />
        </div>
      </section>
    );
  }

  return (
    <div className="report-grid">
      <div className="metric-strip">
        <Metric label="Total leads" value={String(report.enquiries.total)} />
        <Metric label="Open leads" value={String(report.enquiries.open)} />
        <Metric label="Converted" value={String(report.enquiries.converted)} tone="ok" />
        <Metric label="Lost" value={String(report.enquiries.lost)} tone={report.enquiries.lost ? "warn" : "ok"} />
        <Metric label="Conversion rate" value={`${conversionRate}%`} />
      </div>
      <section className="panel">
        <h2>Lead sources</h2>
        <CountBars rows={report.enquiries.bySource.map((item) => ({ label: item.source, value: item.count }))} />
      </section>
      <section className="panel">
        <h2>Enquiry status</h2>
        <CountBars rows={report.enquiries.byStatus.map((item) => ({ label: statusLabel(item.status), value: item.count }))} />
      </section>
    </div>
  );
}

function JobCardReport({ report, compact }: { report: ReportData; compact?: boolean }) {
  if (compact) {
    return (
      <section className="panel">
        <h2>Job card snapshot</h2>
        <div className="summary-rows">
          <Row label="Open" value={String(report.jobCards.open)} />
          <Row label="In progress" value={String(report.jobCards.inProgress)} />
          <Row label="Billed revenue" value={formatMoney(report.jobCards.billedRevenue)} />
        </div>
      </section>
    );
  }

  return (
    <div className="report-grid">
      <div className="metric-strip">
        <Metric label="Total job cards" value={String(report.jobCards.total)} />
        <Metric label="Open" value={String(report.jobCards.open)} tone={report.jobCards.open ? "warn" : "ok"} />
        <Metric label="In progress" value={String(report.jobCards.inProgress)} />
        <Metric label="Completed" value={String(report.jobCards.completed)} tone="ok" />
        <Metric label="Billed revenue" value={formatMoney(report.jobCards.billedRevenue)} />
        <Metric label="Avg turnaround" value={`${report.jobCards.averageTurnaroundDays} day(s)`} />
      </div>
      <section className="panel wide-panel">
        <h2>Job card status</h2>
        <CountBars rows={report.jobCards.byStatus.map((item) => ({ label: statusLabel(item.status), value: item.count }))} />
      </section>
    </div>
  );
}

function ProfitExpenseReport({
  profit,
  expenseForm,
  setExpenseForm,
  savingExpense,
  saveExpense,
  deleteExpense,
  compact
}: {
  profit: ProfitReportData;
  expenseForm?: ExpenseInput;
  setExpenseForm?: (input: ExpenseInput) => void;
  savingExpense?: boolean;
  saveExpense?: () => void;
  deleteExpense?: (expense: Expense) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <section className="panel">
        <h2>Profit snapshot</h2>
        <div className="summary-rows">
          <Row label="Paid revenue" value={formatMoney(profit.paidRevenue)} />
          <Row label="Cash profit" value={formatMoney(profit.cashProfit)} />
          <Row label="Margin" value={`${profit.profitMargin}%`} />
        </div>
      </section>
    );
  }

  return (
    <div className="report-grid">
      <div className="metric-strip">
        <Metric label="Paid revenue" value={formatMoney(profit.paidRevenue)} />
        <Metric label="Stock cost" value={formatMoney(profit.stockCost)} tone={profit.stockCost ? "warn" : "ok"} />
        <Metric label="Expenses" value={formatMoney(profit.expenseTotal)} tone={profit.expenseTotal ? "warn" : "ok"} />
        <Metric label="Cash profit" value={formatMoney(profit.cashProfit)} tone={profit.cashProfit >= 0 ? "ok" : "warn"} />
        <Metric label="Margin" value={`${profit.profitMargin}%`} tone={profit.profitMargin >= 0 ? "ok" : "warn"} />
      </div>
      <section className="panel wide-panel">
        <h2>Profit trend</h2>
        <ProfitTrendSvg profit={profit} />
      </section>
      <section className="panel">
        <h2>Expense categories</h2>
        <HorizontalBars rows={profit.expensesByCategory.map((item) => ({ label: item.category, value: item.amount }))} />
      </section>
      {expenseForm && setExpenseForm && saveExpense && (
        <section className="panel wide-panel no-print">
          <div className="panel-heading">
            <div>
              <h2>{expenseForm.id ? "Edit expense" : "Add expense"}</h2>
              <p>Manual expense entry used for cash-profit reporting.</p>
            </div>
            {expenseForm.id && <button className="ghost-button" onClick={() => setExpenseForm(emptyExpenseInput())}>New expense</button>}
          </div>
          <div className="form-grid four">
            <label>Date<input type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm({ ...expenseForm, expenseDate: event.currentTarget.value })} /></label>
            <label>Category<input value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.currentTarget.value })} /></label>
            <label>Amount<input type="number" min="0" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: Number(event.currentTarget.value) })} /></label>
            <label>Mode<select value={expenseForm.paymentMode} onChange={(event) => setExpenseForm({ ...expenseForm, paymentMode: event.currentTarget.value as PaymentMode })}>{paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
            <label>Vendor<input value={expenseForm.vendor || ""} onChange={(event) => setExpenseForm({ ...expenseForm, vendor: event.currentTarget.value })} /></label>
            <label>Reference<input value={expenseForm.reference || ""} onChange={(event) => setExpenseForm({ ...expenseForm, reference: event.currentTarget.value })} /></label>
            <label className="wide-input">Notes<textarea value={expenseForm.notes || ""} onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.currentTarget.value })} /></label>
            <button className="primary-action align-bottom" disabled={savingExpense} onClick={saveExpense}><Save size={18} /> {savingExpense ? "Saving..." : "Save expense"}</button>
          </div>
        </section>
      )}
      <section className="panel wide-panel">
        <h2>Expense audit</h2>
        <ExpenseTable expenses={profit.expenses} setExpenseForm={setExpenseForm} deleteExpense={deleteExpense} />
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function HorizontalBars({ rows }: { rows: Array<{ label: string; value: number; hint?: string; tone?: "warn" }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <div className="empty-state subtle">No report data in this range.</div>;
  return (
    <div className="report-bars">
      {rows.map((row) => (
        <div className="report-bar-row" key={row.label}>
          <div>
            <strong>{row.label}</strong>
            {row.hint && <span>{row.hint}</span>}
          </div>
          <div className="report-bar-track"><b className={row.tone === "warn" ? "warn" : ""} style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} /></div>
          <em>{formatMoney(row.value)}</em>
        </div>
      ))}
    </div>
  );
}

function CountBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <div className="empty-state subtle">No report data in this range.</div>;
  return (
    <div className="report-bars">
      {rows.map((row) => (
        <div className="report-bar-row compact" key={row.label}>
          <div><strong>{row.label}</strong><span>{percent(row.value, total)}%</span></div>
          <div className="report-bar-track"><b style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} /></div>
          <em>{row.value}</em>
        </div>
      ))}
    </div>
  );
}

function LineAreaChart({
  points,
  primaryKey,
  secondaryKey,
  primaryLabel,
  secondaryLabel
}: {
  points: ChartPoint[];
  primaryKey: string;
  secondaryKey: string;
  primaryLabel: string;
  secondaryLabel: string;
}) {
  if (!points.length) return <div className="empty-state subtle">No trend data in this range.</div>;
  const width = 920;
  const height = 260;
  const left = 44;
  const top = 18;
  const base = 204;
  const max = Math.max(1, ...points.map((point) => Math.max(Number(point[primaryKey] || 0), Number(point[secondaryKey] || 0))));
  const coords = points.map((point, index) => {
    const x = left + (index * (width - left - 24)) / Math.max(1, points.length - 1);
    const primaryY = base - (Number(point[primaryKey] || 0) / max) * (base - top);
    const secondaryY = base - (Number(point[secondaryKey] || 0) / max) * (base - top);
    return { ...point, x, primaryY, secondaryY };
  });
  const primaryPath = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.primaryY}`).join(" ");
  const secondaryPath = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.secondaryY}`).join(" ");
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  const areaPath = firstCoord && lastCoord ? `${primaryPath} L ${lastCoord.x} ${base} L ${firstCoord.x} ${base} Z` : "";

  return (
    <div className="report-chart-wrap">
      <div className="chart-legend"><span className="primary-line" /> {primaryLabel}<span className="secondary-line" /> {secondaryLabel}</div>
      <svg className="report-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${primaryLabel} and ${secondaryLabel} trend`}>
        {[0, 0.5, 1].map((tick) => {
          const y = base - tick * (base - top);
          return (
            <g key={tick}>
              <line x1={left} x2={width - 16} y1={y} y2={y} />
              <text x={0} y={y + 4}>{formatCompactMoney(max * tick)}</text>
            </g>
          );
        })}
        {areaPath && <path className="chart-fill" d={areaPath} />}
        <path className="chart-line secondary" d={secondaryPath} />
        <path className="chart-line primary" d={primaryPath} />
        {coords.map((point) => (
          <g key={`${point.label}-${point.x}`}>
            <circle cx={point.x} cy={point.primaryY} r={4} />
            <text className="chart-day" x={point.x} y={236}>{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function ProfitTrendSvg({ profit }: { profit: ProfitReportData }) {
  const points = profit.trend.map((item) => ({
    label: item.label,
    paidRevenue: item.paidRevenue,
    cashProfit: Math.max(0, item.cashProfit)
  }));
  return (
    <LineAreaChart
      points={points}
      primaryKey="cashProfit"
      secondaryKey="paidRevenue"
      primaryLabel="Cash profit"
      secondaryLabel="Paid revenue"
    />
  );
}

function InventoryItemList({ items }: { items: InventoryItem[] }) {
  if (!items.length) return <div className="empty-state subtle">No low stock records.</div>;
  return (
    <div className="stack-list">
      {items.map((item) => (
        <div className="stack-row" key={item.id}>
          <div><strong>{item.name}</strong><span>{item.currentQuantity} {item.unit} available | low alert {item.lowStockLevel}</span></div>
          <b>{formatMoney(item.stockValue)}</b>
        </div>
      ))}
    </div>
  );
}

function InventoryMovementTable({ movements }: { movements: InventoryMovement[] }) {
  if (!movements.length) return <div className="empty-state subtle">No stock movements in this range.</div>;
  return (
    <div className="table-wrap">
      <table className="compact-table">
        <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Cost</th><th>Sale</th><th>Payment</th><th>Reference</th></tr></thead>
        <tbody>
          {movements.slice(0, 16).map((movement) => (
            <tr key={movement.id}>
              <td>{movement.movementDate}</td>
              <td>{movement.itemName}</td>
              <td>{statusLabel(movement.type)}</td>
              <td>{movement.quantity} {movement.itemUnit}</td>
              <td>{formatMoney(movement.quantity * movement.unitCost)}</td>
              <td>{movement.type === "stock_sale" ? formatMoney(movement.saleAmount) : "-"}</td>
              <td>{movement.type === "stock_sale" ? movement.paymentMode || "Cash" : "-"}</td>
              <td>{movement.reference || movement.notes || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseTable({
  expenses,
  setExpenseForm,
  deleteExpense
}: {
  expenses: Expense[];
  setExpenseForm?: (input: ExpenseInput) => void;
  deleteExpense?: (expense: Expense) => void;
}) {
  if (!expenses.length) return <div className="empty-state subtle">No expenses available.</div>;
  return (
    <div className="table-wrap">
      <table className="compact-table">
        <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Mode</th><th>Amount</th><th>Reference</th><th className="no-print"></th></tr></thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.id}>
              <td>{expense.expenseDate}</td>
              <td>{expense.category}</td>
              <td>{expense.vendor || "-"}</td>
              <td>{expense.paymentMode}</td>
              <td>{formatMoney(expense.amount)}</td>
              <td>{expense.reference || expense.notes || "-"}</td>
              <td className="actions-cell no-print">
                {setExpenseForm && <button className="ghost-button small" onClick={() => setExpenseForm(expense)}>Edit</button>}
                {deleteExpense && <button className="ghost-button small danger-text" onClick={() => deleteExpense(expense)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const stockValue = (items: InventoryItem[]) => money(items.reduce((sum, item) => sum + item.stockValue, 0));
const activeStockCount = (items: InventoryItem[]) => items.filter((item) => item.active).length;
const formatCompactMoney = (value: number) => {
  const rounded = money(value);
  if (rounded >= 100000) return `${Math.round(rounded / 100000)}L`;
  if (rounded >= 1000) return `${Math.round(rounded / 1000)}K`;
  return String(Math.round(rounded));
};
