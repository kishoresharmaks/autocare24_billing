import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react-native";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileText,
  Package,
  Percent,
  Phone,
  ReceiptText,
  RefreshCcw,
  Users,
  Wallet
} from "lucide-react-native";
import { fetchInvoices, fetchProfit, fetchReport } from "../../src/services/cloudApi";
import { ExportActions } from "../../src/components/ExportActions";
import { RangeSelector } from "../../src/components/RangeSelector";
import { Screen } from "../../src/components/Screen";
import {
  exportReportCategoryDocument,
  exportReportsDocument,
  type ExportFormat,
  type ReportCategoryId
} from "../../src/services/reportExport";
import { colors, radius } from "../../src/theme";
import type {
  DateRangePreset,
  Expense,
  InventoryBatch,
  InventoryItem,
  InventoryMovement,
  InvoiceSummary,
  ProfitReportData,
  ReportData,
  ReportDateFilter
} from "../../src/types/cloud";
import { formatCount, formatDate, formatDateTime, formatMoney, titleCase } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";

type ReportRangeMode = DateRangePreset | "custom";
type CustomReportDateFilter = { fromDate: string; toDate: string; preset?: "" };
type CategoryConfig = {
  id: ReportCategoryId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
};
type StockBatch = InventoryBatch & { itemName?: string; unit?: string };

const REPORT_CATEGORIES: CategoryConfig[] = [
  { id: "sales", title: "Sales Report", subtitle: "Billing, invoices, cancellations, and top services", icon: ReceiptText },
  { id: "gst", title: "GST / Tax Report", subtitle: "Taxable value with CGST, SGST, IGST, and total tax", icon: Percent },
  { id: "payments", title: "Payment & Dues", subtitle: "Collections by mode and unpaid invoice follow-up", icon: Wallet },
  { id: "stock", title: "Stock Report", subtitle: "Closing stock value, low stock, batches, and movements", icon: Package },
  { id: "enquiries", title: "Enquiry Report", subtitle: "Lead conversion, status, and source breakdown", icon: Users },
  { id: "jobCards", title: "Job Card Report", subtitle: "Workshop status, billing conversion, and turnaround", icon: ClipboardList },
  { id: "profit", title: "Profit & Expense", subtitle: "Paid revenue, stock cost, expenses, and cash profit", icon: CircleDollarSign }
];

export default function ReportsTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const [rangeMode, setRangeMode] = useState<ReportRangeMode>("30d");
  const [selectedCategory, setSelectedCategory] = useState<ReportCategoryId | null>(null);
  const [draftFromDate, setDraftFromDate] = useState(defaultFromDate());
  const [draftToDate, setDraftToDate] = useState(todayDate());
  const [appliedCustomRange, setAppliedCustomRange] = useState<CustomReportDateFilter>({
    fromDate: defaultFromDate(),
    toDate: todayDate(),
    preset: ""
  });
  const customDateError = rangeMode === "custom" ? validateDateRange(draftFromDate, draftToDate) : "";
  const reportFilter = useMemo<ReportDateFilter>(() => (rangeMode === "custom" ? appliedCustomRange : rangeMode), [appliedCustomRange, rangeMode]);
  const reportFilterKey = typeof reportFilter === "string" ? reportFilter : `custom:${reportFilter.fromDate || ""}:${reportFilter.toDate || ""}`;
  const reportQuery = useQuery({
    queryKey: ["report", reportFilterKey, session.cloudUrl, session.token],
    queryFn: () => fetchReport(session.cloudUrl, session.token, reportFilter),
    enabled: Boolean(session.user && session.token)
  });
  const profitQuery = useQuery({
    queryKey: ["profit", reportFilterKey, session.cloudUrl, session.token],
    queryFn: () => fetchProfit(session.cloudUrl, session.token, reportFilter),
    enabled: Boolean(session.user && session.token)
  });
  const invoicesQuery = useQuery({
    queryKey: ["report-export-invoices", session.cloudUrl, session.token],
    queryFn: () => fetchInvoices(session.cloudUrl, session.token, ""),
    enabled: Boolean(session.user && session.token && session.approvalStatus === "APPROVED")
  });
  const report = reportQuery.data;
  const profit = profitQuery.data;
  const selectedConfig = REPORT_CATEGORIES.find((category) => category.id === selectedCategory) || null;
  const isRefreshing = reportQuery.isFetching || profitQuery.isFetching || invoicesQuery.isFetching;
  const globalExportDisabled = !report || isRefreshing || Boolean(reportQuery.error || profitQuery.error || invoicesQuery.error);
  const categoryExportDisabled = selectedCategory
    ? selectedCategory === "profit"
      ? !profit || profitQuery.isFetching || Boolean(profitQuery.error)
      : selectedCategory === "sales"
        ? !report || reportQuery.isFetching || invoicesQuery.isFetching || Boolean(reportQuery.error || invoicesQuery.error)
        : !report || reportQuery.isFetching || Boolean(reportQuery.error)
    : true;

  if (guard) return guard;

  function applyCustomRange() {
    if (customDateError) return;
    setAppliedCustomRange({
      fromDate: draftFromDate.trim(),
      toDate: draftToDate.trim(),
      preset: ""
    });
    setRangeMode("custom");
  }

  function refreshAll() {
    void Promise.all([reportQuery.refetch(), profitQuery.refetch(), invoicesQuery.refetch()]);
  }

  async function exportAllReports(format: ExportFormat) {
    if (!report) throw new Error("Report data is not loaded yet.");
    if (reportQuery.error || profitQuery.error || invoicesQuery.error) throw new Error("Refresh report data before exporting.");
    await exportReportsDocument({
      report,
      profit,
      invoices: invoicesQuery.data || [],
      filter: reportFilter,
      format
    });
  }

  async function exportCategoryReport(format: ExportFormat) {
    if (!selectedCategory) return;
    if (!report) throw new Error("Report data is not loaded yet.");
    if (selectedCategory === "profit" && !profit) throw new Error("Profit report data is not loaded yet.");
    if (reportQuery.error || (selectedCategory === "profit" && profitQuery.error) || (selectedCategory === "sales" && invoicesQuery.error)) {
      throw new Error("Refresh this report before exporting.");
    }
    await exportReportCategoryDocument({
      category: selectedCategory,
      report,
      profit,
      invoices: invoicesQuery.data || [],
      filter: reportFilter,
      format
    });
  }

  return (
    <Screen
      title={selectedConfig?.title || "Reports"}
      subtitle={selectedConfig?.subtitle || "Focused owner review across sales, dues, stock, jobs, and profit"}
      right={<RangeSelector<ReportRangeMode> value={rangeMode} onChange={setRangeMode} includeCustom />}
      refreshing={isRefreshing}
      onRefresh={refreshAll}
      showHome
    >
      {reportQuery.error ? (
        <ErrorPanel message={reportQuery.error instanceof Error ? reportQuery.error.message : "Unable to load reports."} />
      ) : null}
      {profitQuery.error ? (
        <ErrorPanel message={profitQuery.error instanceof Error ? `Profit report: ${profitQuery.error.message}` : "Unable to load profit report."} />
      ) : null}
      {invoicesQuery.error ? (
        <ErrorPanel message={invoicesQuery.error instanceof Error ? `Invoice details for export: ${invoicesQuery.error.message}` : "Unable to load invoice details for export."} />
      ) : null}

      <PeriodPanel report={report} rangeMode={rangeMode} appliedCustomRange={appliedCustomRange} refreshing={isRefreshing} />

      {rangeMode === "custom" ? (
        <CustomDatePanel
          appliedCustomRange={appliedCustomRange}
          customDateError={customDateError}
          draftFromDate={draftFromDate}
          draftToDate={draftToDate}
          onApply={applyCustomRange}
          onFromDateChange={setDraftFromDate}
          onToDateChange={setDraftToDate}
        />
      ) : null}

      {selectedCategory ? (
        <CategoryDetail
          category={selectedCategory}
          disabledExport={categoryExportDisabled}
          filter={reportFilter}
          invoices={invoicesQuery.data || []}
          onBack={() => setSelectedCategory(null)}
          onExport={exportCategoryReport}
          profit={profit}
          report={report}
        />
      ) : (
        <ReportHub
          disabledExport={globalExportDisabled}
          onExport={exportAllReports}
          onSelectCategory={setSelectedCategory}
          profit={profit}
          report={report}
        />
      )}
    </Screen>
  );
}

function ReportHub({
  disabledExport,
  onExport,
  onSelectCategory,
  profit,
  report
}: {
  disabledExport: boolean;
  onExport: (format: ExportFormat) => Promise<void>;
  onSelectCategory: (category: ReportCategoryId) => void;
  profit?: ProfitReportData;
  report?: ReportData;
}) {
  return (
    <>
      <ExportActions disabled={disabledExport} onExport={onExport} />
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryIcon}>
            <BarChart3 color={colors.primary} size={22} />
          </View>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.sectionTitle}>Full Business Summary</Text>
            <Text style={styles.sectionSub}>Combined view across sales, tax, dues, stock, jobs, and profit</Text>
          </View>
        </View>
        <Text style={styles.summaryLabel}>Revenue</Text>
        <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(report?.revenue)}
        </Text>
        <View style={styles.summaryStats}>
          <SummaryStat label="Collected" value={formatMoney(report?.paidAmount)} tone="success" />
          <SummaryStat label="Pending Due" value={formatMoney(report?.balanceDue)} tone="warning" />
          <SummaryStat label="Cash Profit" value={formatMoney(profit?.cashProfit)} tone={safeNumber(profit?.cashProfit) >= 0 ? "success" : "danger"} />
          <SummaryStat label="Invoices" value={formatCount(report?.invoiceCount)} />
        </View>
      </View>
      <View style={styles.categoryGrid}>
        {REPORT_CATEGORIES.map((category) => (
          <ReportCategoryCard
            key={category.id}
            config={category}
            metric={categoryMetric(category.id, report, profit)}
            onPress={() => onSelectCategory(category.id)}
          />
        ))}
      </View>
    </>
  );
}

function ReportCategoryCard({ config, metric, onPress }: { config: CategoryConfig; metric: string; onPress: () => void }) {
  const Icon = config.icon;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.categoryCard, pressed ? styles.pressed : null]}>
      <View style={styles.categoryTop}>
        <View style={styles.categoryIcon}>
          <Icon color={colors.primary} size={21} />
        </View>
        <ChevronRight color={colors.primary} size={19} />
      </View>
      <Text style={styles.categoryTitle} numberOfLines={2}>
        {config.title}
      </Text>
      <Text style={styles.categorySubtitle} numberOfLines={2}>
        {config.subtitle}
      </Text>
      <Text style={styles.categoryMetric} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {metric}
      </Text>
    </Pressable>
  );
}

function CategoryDetail({
  category,
  disabledExport,
  filter,
  invoices,
  onBack,
  onExport,
  profit,
  report
}: {
  category: ReportCategoryId;
  disabledExport: boolean;
  filter: ReportDateFilter;
  invoices: InvoiceSummary[];
  onBack: () => void;
  onExport: (format: ExportFormat) => Promise<void>;
  profit?: ProfitReportData;
  report?: ReportData;
}) {
  const config = REPORT_CATEGORIES.find((item) => item.id === category) || REPORT_CATEGORIES[0];
  return (
    <>
      <View style={styles.detailHeader}>
        <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.backToReports, pressed ? styles.pressed : null]}>
          <ArrowLeft color={colors.primary} size={17} />
          <Text style={styles.backToReportsText}>Reports</Text>
        </Pressable>
        <View style={styles.detailTitleWrap}>
          <Text style={styles.detailTitle}>{config.title}</Text>
          <Text style={styles.detailSub}>{config.subtitle}</Text>
        </View>
      </View>
      <ExportActions disabled={disabledExport} onExport={onExport} />
      <CategoryContent category={category} filter={filter} invoices={invoices} profit={profit} report={report} />
    </>
  );
}

function CategoryContent({
  category,
  filter,
  invoices,
  profit,
  report
}: {
  category: ReportCategoryId;
  filter: ReportDateFilter;
  invoices: InvoiceSummary[];
  profit?: ProfitReportData;
  report?: ReportData;
}) {
  if (category === "profit") {
    return profit ? <ProfitReportDetail profit={profit} /> : <LoadingState title="Profit report is loading" />;
  }
  if (!report) return <LoadingState title="Report data is loading" />;
  if (category === "sales") return <SalesReportDetail filter={filter} invoices={invoices} report={report} />;
  if (category === "gst") return <GstReportDetail report={report} />;
  if (category === "payments") return <PaymentDuesReportDetail report={report} />;
  if (category === "stock") return <StockReportDetail report={report} />;
  if (category === "enquiries") return <EnquiryReportDetail report={report} />;
  return <JobCardReportDetail report={report} />;
}

function SalesReportDetail({ filter, invoices, report }: { filter: ReportDateFilter; invoices: InvoiceSummary[]; report: ReportData }) {
  const filteredInvoices = filterInvoicesByReportRange(invoices, filter);
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Billed Value</Text>
        <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(report.revenue)}
        </Text>
        <View style={styles.summaryStats}>
          <SummaryStat label="Collected" value={formatMoney(report.paidAmount)} tone="success" />
          <SummaryStat label="Invoices" value={formatCount(report.invoiceCount)} />
          <SummaryStat label="Cancelled" value={formatCount(report.cancelledCount)} tone="danger" />
        </View>
      </View>
      <ReportSection icon={ReceiptText} title="Top Services" subtitle="Best performing services by billed value">
        {(report.topServices || []).map((service, index) => (
          <RankedRow
            key={`${service.name}-${index}`}
            rank={index + 1}
            title={service.name || "Unnamed service"}
            subtitle={`${formatCount(service.quantity)} service(s)`}
            value={formatMoney(service.revenue)}
          />
        ))}
        {!report.topServices?.length ? <EmptyState icon={ReceiptText} title="No services in this range" detail="Final invoices with service lines will appear here." /> : null}
      </ReportSection>
      <ReportSection icon={FileText} title="Invoice Details" subtitle="Sales invoices in the selected period">
        {filteredInvoices.slice(0, 30).map((invoice) => (
          <InvoiceRow key={invoice.id} invoice={invoice} />
        ))}
        {!filteredInvoices.length ? <EmptyState icon={FileText} title="No invoices in this range" detail="Final invoice rows will appear after billing is synced." /> : null}
      </ReportSection>
    </>
  );
}

function GstReportDetail({ report }: { report: ReportData }) {
  return (
    <ReportSection icon={Percent} title="GST Breakdown" subtitle="Taxable value and tax split">
      <DataRow label="Taxable Value" value={formatMoney(report.taxableValue)} />
      <DataRow label="CGST" value={formatMoney(report.cgst)} />
      <DataRow label="SGST" value={formatMoney(report.sgst)} />
      <DataRow label="IGST" value={formatMoney(report.igst)} />
      <DataRow label="Total Tax" value={formatMoney(report.totalTax)} emphasis />
    </ReportSection>
  );
}

function PaymentDuesReportDetail({ report }: { report: ReportData }) {
  const paymentTotal = safeNumber(report.paidAmount);
  return (
    <>
      <ReportSection icon={CreditCard} title="Payment Modes" subtitle="Collections grouped by payment method">
        {(report.paymentModes || []).map((mode) => (
          <DataRow key={mode.mode} label={titleCase(mode.mode)} value={formatMoney(mode.amount)} detail={formatPercent(mode.amount, paymentTotal)} />
        ))}
        {!report.paymentModes?.length ? <EmptyState icon={CreditCard} title="No payments in this range" detail="Collections will appear here when payments are synced." /> : null}
      </ReportSection>
      <ReportSection icon={Wallet} title="Pending Dues" subtitle="All unpaid invoices returned by the report">
        <DataRow label="Closing Pending Due" value={formatMoney(report.balanceDue)} tone={safeNumber(report.balanceDue) > 0 ? "warning" : "success"} emphasis />
        {(report.dues || []).map((invoice: InvoiceSummary) => (
          <DueRow key={invoice.id} invoice={invoice} />
        ))}
        {!report.dues?.length ? <EmptyState icon={Wallet} title="No pending dues" detail="Every invoice in this period is fully collected." /> : null}
      </ReportSection>
    </>
  );
}

function StockReportDetail({ report }: { report: ReportData }) {
  const inventory = report.inventory;
  return (
    <>
      <ReportSection icon={Package} title="Inventory Snapshot" subtitle="Stock position included in the report response">
        <DataRow label="Stock Value" value={formatMoney(inventory?.totalStockValue)} />
        <DataRow label="Low Stock Items" value={formatCount(inventory?.lowStockCount)} tone={safeNumber(inventory?.lowStockCount) > 0 ? "warning" : "default"} />
        <DataRow label="Expiring Batches" value={formatCount(inventory?.expiringCount)} tone={safeNumber(inventory?.expiringCount) > 0 ? "warning" : "default"} />
        <DataRow label="Retail Items" value={formatCount(inventory?.retailCount)} />
      </ReportSection>
      <ReportSection icon={Package} title="Stock Items" subtitle="Available inventory rows">
        {(inventory?.items || []).slice(0, 30).map((item) => (
          <StockItemRow key={item.id} item={item} />
        ))}
        {!inventory?.items?.length ? <EmptyState icon={Package} title="No stock items" detail="Inventory rows will appear when stock items are synced." /> : null}
      </ReportSection>
      <ReportSection icon={AlertCircle} title="Low Stock" subtitle="Items at or below low-stock level">
        {(inventory?.lowStockItems || []).map((item) => (
          <StockItemRow key={item.id} item={item} />
        ))}
        {!inventory?.lowStockItems?.length ? <EmptyState icon={AlertCircle} title="No low stock items" detail="Low-stock alerts will appear here." /> : null}
      </ReportSection>
      <ReportSection icon={CalendarDays} title="Expiring Batches" subtitle="Batches nearing expiry">
        {(inventory?.expiringBatches || []).map((batch) => (
          <StockBatchRow key={batch.id} batch={batch} />
        ))}
        {!inventory?.expiringBatches?.length ? <EmptyState icon={CalendarDays} title="No expiring batches" detail="Expiring stock batches will appear here." /> : null}
      </ReportSection>
      <ReportSection icon={RefreshCcw} title="Recent Stock Movements" subtitle="Purchases, sales, usage, adjustments, and reversals">
        {((inventory?.movements || inventory?.recentMovements) || []).slice(0, 20).map((movement) => (
          <MovementRow key={movement.id} movement={movement} />
        ))}
        {!((inventory?.movements || inventory?.recentMovements) || []).length ? (
          <EmptyState icon={RefreshCcw} title="No stock movements" detail="Stock movement rows will appear after purchases, sales, or adjustments." />
        ) : null}
      </ReportSection>
    </>
  );
}

function EnquiryReportDetail({ report }: { report: ReportData }) {
  return (
    <ReportSection icon={Users} title="Enquiries" subtitle="Lead status and source summary">
      <ActivityOverview
        items={[
          { label: "Total", value: formatCount(report.enquiries?.total) },
          { label: "Open", value: formatCount(report.enquiries?.open), tone: safeNumber(report.enquiries?.open) > 0 ? "warning" : "default" },
          { label: "Converted", value: formatCount(report.enquiries?.converted), tone: "success" },
          { label: "Lost", value: formatCount(report.enquiries?.lost), tone: "danger" }
        ]}
      />
      <BreakdownList
        title="Status Breakdown"
        total={safeNumber(report.enquiries?.total)}
        rows={(report.enquiries?.byStatus || []).map((item) => ({ label: titleCase(item.status), count: item.count }))}
        emptyTitle="No enquiry status data"
      />
      <BreakdownList
        title="Source Breakdown"
        total={safeNumber(report.enquiries?.total)}
        rows={(report.enquiries?.bySource || []).map((item) => ({ label: titleCase(item.source || "Unknown"), count: item.count }))}
        emptyTitle="No enquiry source data"
      />
    </ReportSection>
  );
}

function JobCardReportDetail({ report }: { report: ReportData }) {
  return (
    <ReportSection icon={ClipboardList} title="Job Cards" subtitle="Work status and billing conversion">
      <ActivityOverview
        items={[
          { label: "Total", value: formatCount(report.jobCards?.total) },
          { label: "Open", value: formatCount(report.jobCards?.open), tone: safeNumber(report.jobCards?.open) > 0 ? "warning" : "default" },
          { label: "Running", value: formatCount(report.jobCards?.inProgress) },
          { label: "Done", value: formatCount(report.jobCards?.completed), tone: "success" }
        ]}
      />
      <ActivityOverview
        items={[
          {
            label: "Approval",
            value: formatCount(report.jobCards?.approvalPending),
            tone: safeNumber(report.jobCards?.approvalPending) > 0 ? "warning" : "default"
          },
          { label: "Billed", value: formatCount(report.jobCards?.billed) },
          { label: "Cancelled", value: formatCount(report.jobCards?.cancelled), tone: "danger" }
        ]}
      />
      <DataRow label="Billed Revenue" value={formatMoney(report.jobCards?.billedRevenue)} emphasis />
      <DataRow label="Avg. Turnaround" value={`${formatCount(report.jobCards?.averageTurnaroundDays)} day(s)`} />
      <BreakdownList
        title="Status Breakdown"
        total={safeNumber(report.jobCards?.total)}
        rows={(report.jobCards?.byStatus || []).map((item) => ({ label: titleCase(item.status), count: item.count }))}
        emptyTitle="No job-card status data"
      />
    </ReportSection>
  );
}

function ProfitReportDetail({ profit }: { profit: ProfitReportData }) {
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Cash Profit</Text>
        <Text style={[styles.summaryValue, safeNumber(profit.cashProfit) < 0 ? styles.summaryValueDanger : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(profit.cashProfit)}
        </Text>
        <View style={styles.summaryStats}>
          <SummaryStat label="Paid Revenue" value={formatMoney(profit.paidRevenue)} tone="success" />
          <SummaryStat label="Stock Cost" value={formatMoney(profit.stockCost)} />
          <SummaryStat label="Expenses" value={formatMoney(profit.expenseTotal)} tone="warning" />
          <SummaryStat label="Margin" value={`${safeNumber(profit.profitMargin).toFixed(2)}%`} />
        </View>
      </View>
      <ReportSection icon={CircleDollarSign} title="Expense Categories" subtitle="Expenses grouped by category">
        {(profit.expensesByCategory || []).map((category) => (
          <DataRow key={category.category} label={category.category || "Other"} value={formatMoney(category.amount)} />
        ))}
        {!profit.expensesByCategory?.length ? <EmptyState icon={CircleDollarSign} title="No expense categories" detail="Expenses will appear when records are synced." /> : null}
      </ReportSection>
      <ReportSection icon={FileText} title="Recent Expenses" subtitle="Latest expense rows in this period">
        {(profit.expenses || []).slice(0, 20).map((expense: Expense) => (
          <ExpenseRow key={expense.id} expense={expense} />
        ))}
        {!profit.expenses?.length ? <EmptyState icon={FileText} title="No expense records" detail="Expense rows will appear after adding expenses." /> : null}
      </ReportSection>
    </>
  );
}

function PeriodPanel({
  appliedCustomRange,
  rangeMode,
  refreshing,
  report
}: {
  appliedCustomRange: CustomReportDateFilter;
  rangeMode: ReportRangeMode;
  refreshing: boolean;
  report?: ReportData;
}) {
  return (
    <View style={styles.periodPanel}>
      <View style={styles.periodIcon}>
        <CalendarDays color={colors.primary} size={20} />
      </View>
      <View style={styles.periodText}>
        <Text style={styles.periodLabel}>Report Period</Text>
        <Text style={styles.periodValue} numberOfLines={2}>
          {report?.rangeLabel || selectedRangeLabel(rangeMode, appliedCustomRange)}
        </Text>
      </View>
      <View style={[styles.refreshPill, refreshing ? styles.refreshPillActive : null]}>
        <RefreshCcw color={refreshing ? colors.primary : colors.muted} size={14} />
        <Text style={[styles.refreshText, refreshing ? styles.refreshTextActive : null]}>{refreshing ? "Refreshing" : "Synced"}</Text>
      </View>
    </View>
  );
}

function CustomDatePanel({
  appliedCustomRange,
  customDateError,
  draftFromDate,
  draftToDate,
  onApply,
  onFromDateChange,
  onToDateChange
}: {
  appliedCustomRange: CustomReportDateFilter;
  customDateError: string;
  draftFromDate: string;
  draftToDate: string;
  onApply: () => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
}) {
  return (
    <View style={styles.customPanel}>
      <View style={styles.customHeader}>
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>Custom Date Range</Text>
          <Text style={styles.sectionSub}>Applied: {formatCustomRangeLabel(appliedCustomRange)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(customDateError)}
          onPress={onApply}
          style={({ pressed }) => [styles.applyButton, customDateError ? styles.applyButtonDisabled : null, pressed ? styles.pressed : null]}
        >
          <Text style={[styles.applyButtonText, customDateError ? styles.applyButtonTextDisabled : null]}>Apply Dates</Text>
        </Pressable>
      </View>
      <View style={styles.dateFieldRow}>
        <DateInput label="From" value={draftFromDate} onChangeText={onFromDateChange} />
        <DateInput label="To" value={draftToDate} onChangeText={onToDateChange} />
      </View>
      {customDateError ? <Text style={styles.errorText}>{customDateError}</Text> : null}
    </View>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <View style={styles.errorPanel}>
      <AlertCircle color={colors.danger} size={18} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function LoadingState({ title }: { title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.emptyInline}>{title}</Text>
    </View>
  );
}

function ReportSection({ icon: Icon, title, subtitle, children }: { icon: LucideIcon; title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Icon color={colors.primary} size={18} />
        </View>
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSub}>{subtitle}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function SummaryStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "warning" | "danger" }) {
  return (
    <View style={[styles.summaryStat, styles[`${tone}Stat`]]}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={styles.summaryStatValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

function DataRow({
  label,
  value,
  detail,
  tone = "default",
  emphasis = false
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "success" | "warning" | "danger";
  emphasis?: boolean;
}) {
  return (
    <View style={[styles.dataRow, emphasis ? styles.dataRowEmphasis : null]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        {detail ? <Text style={styles.rowSub}>{detail}</Text> : null}
      </View>
      <Text style={[styles.amount, styles[`${tone}Amount`]]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {value}
      </Text>
    </View>
  );
}

function RankedRow({ rank, title, subtitle, value }: { rank: number; title: string; subtitle: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{rank}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {value}
      </Text>
    </View>
  );
}

function InvoiceRow({ invoice }: { invoice: InvoiceSummary }) {
  const subtitle = [invoice.customerName, invoice.vehicleNumber, formatDate(invoice.invoiceDate)].filter(Boolean).join(" / ");
  return (
    <View style={styles.dataRow}>
      <View style={styles.dueIcon}>
        <FileText color={colors.primary} size={16} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {invoice.invoiceNumber || invoice.customerName || "Invoice"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {formatMoney(invoice.grandTotal)}
      </Text>
    </View>
  );
}

function DueRow({ invoice }: { invoice: InvoiceSummary }) {
  const phoneNumber = normalizedPhoneNumber(invoice.customerPhone);
  const subtitle = [invoice.customerName, invoice.vehicleNumber, formatDate(invoice.invoiceDate)].filter(Boolean).join(" / ");
  return (
    <View style={styles.dueRow}>
      <View style={styles.dueIcon}>
        <FileText color={colors.primary} size={16} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {invoice.invoiceNumber || invoice.customerName || "Invoice"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {subtitle}
        </Text>
        {invoice.customerPhone ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {invoice.customerPhone}
          </Text>
        ) : null}
      </View>
      <View style={styles.dueActions}>
        <Text style={[styles.amount, styles.warningAmount, styles.dueAmount]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {formatMoney(invoice.balanceDue)}
        </Text>
        {phoneNumber ? (
          <Pressable
            accessibilityLabel={`Call ${invoice.customerName || invoice.invoiceNumber || "customer"}`}
            accessibilityRole="button"
            onPress={() => callPhoneNumber(phoneNumber)}
            style={({ pressed }) => [styles.callButton, pressed ? styles.pressed : null]}
          >
            <Phone color="#ffffff" size={14} />
            <Text style={styles.callButtonText}>Call</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function StockItemRow({ item }: { item: InventoryItem }) {
  const lowStock = safeNumber(item.lowStockLevel) > 0 && safeNumber(item.currentQuantity) <= safeNumber(item.lowStockLevel);
  return (
    <View style={styles.dataRow}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.name || "Stock item"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {[titleCase(item.type), item.sku || item.category, item.unit].filter(Boolean).join(" / ")}
        </Text>
      </View>
      <View style={styles.stockValues}>
        <Text style={[styles.amount, lowStock ? styles.warningAmount : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {formatCount(item.currentQuantity)} {item.unit || ""}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {formatMoney(item.stockValue)}
        </Text>
      </View>
    </View>
  );
}

function StockBatchRow({ batch }: { batch: StockBatch }) {
  return (
    <View style={styles.dataRow}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {batch.itemName || batch.itemId || "Batch"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {[batch.batchNumber, batch.billNumber, formatDate(batch.expiryDate)].filter(Boolean).join(" / ")}
        </Text>
      </View>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {formatCount(batch.quantityRemaining)} {batch.unit || "unit"}
      </Text>
    </View>
  );
}

function MovementRow({ movement }: { movement: InventoryMovement }) {
  return (
    <View style={styles.dataRow}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {movement.itemName || movement.itemId || "Movement"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {[formatDate(movement.movementDate), titleCase(movement.type), movement.reference].filter(Boolean).join(" / ")}
        </Text>
      </View>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {formatCount(movement.quantity)} {movement.itemUnit || ""}
      </Text>
    </View>
  );
}

function ExpenseRow({ expense }: { expense: Expense }) {
  return (
    <View style={styles.dataRow}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {expense.category || "Expense"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {[expense.vendor, formatDateTime(expense.expenseDate), titleCase(expense.paymentMode)].filter(Boolean).join(" / ")}
        </Text>
      </View>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {formatMoney(expense.amount)}
      </Text>
    </View>
  );
}

function ActivityOverview({
  items
}: {
  items: Array<{ label: string; value: string; tone?: "default" | "success" | "warning" | "danger" }>;
}) {
  return (
    <View style={styles.overviewGrid}>
      {items.map((item) => (
        <View key={item.label} style={[styles.overviewItem, styles[`${item.tone || "default"}Overview`]]}>
          <Text style={styles.overviewValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
            {item.value}
          </Text>
          <Text style={styles.overviewLabel} numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function BreakdownList({ title, rows, total, emptyTitle }: { title: string; rows: Array<{ label: string; count: number }>; total: number; emptyTitle: string }) {
  const visibleRows = rows.filter((row) => safeNumber(row.count) > 0);
  if (!visibleRows.length) {
    return (
      <View style={styles.breakdownBlock}>
        <Text style={styles.subListTitle}>{title}</Text>
        <Text style={styles.emptyInline}>{emptyTitle}</Text>
      </View>
    );
  }
  return (
    <View style={styles.breakdownBlock}>
      <Text style={styles.subListTitle}>{title}</Text>
      {visibleRows.map((row) => (
        <BreakdownRow key={`${title}-${row.label}`} label={row.label} count={safeNumber(row.count)} total={total} />
      ))}
    </View>
  );
}

function BreakdownRow({ label, count, total }: { label: string; count: number; total: number }) {
  const width = total > 0 ? Math.max(5, Math.min(100, (count / total) * 100)) : 0;
  return (
    <View style={styles.breakdownRow}>
      <View style={styles.breakdownTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.breakdownCount}>{formatCount(count)}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${width}%` }]} />
      </View>
    </View>
  );
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <Icon color={colors.muted} size={24} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

function DateInput({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <View style={styles.dateField}>
      <Text style={styles.dateLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label} date`}
        keyboardType="numbers-and-punctuation"
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        style={styles.dateInput}
        value={value}
      />
    </View>
  );
}

function categoryMetric(category: ReportCategoryId, report?: ReportData, profit?: ProfitReportData) {
  if (category === "sales") return formatMoney(report?.revenue);
  if (category === "gst") return formatMoney(report?.totalTax);
  if (category === "payments") return formatMoney(report?.balanceDue);
  if (category === "stock") return formatMoney(report?.inventory?.totalStockValue);
  if (category === "enquiries") return `${formatCount(report?.enquiries?.converted)} converted`;
  if (category === "jobCards") return `${formatCount(report?.jobCards?.open)} open`;
  return formatMoney(profit?.cashProfit);
}

function todayDate() {
  return toIsoDate(new Date());
}

function defaultFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return toIsoDate(date);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validateDateRange(fromDate: string, toDate: string) {
  const from = fromDate.trim();
  const to = toDate.trim();
  if (!from && !to) return "Enter a from date or to date.";
  if (from && !isValidIsoDate(from)) return "From date must be YYYY-MM-DD.";
  if (to && !isValidIsoDate(to)) return "To date must be YYYY-MM-DD.";
  if (from && to && from > to) return "From date cannot be after to date.";
  return "";
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getFullYear() === Number(match[1]) &&
    parsed.getMonth() + 1 === Number(match[2]) &&
    parsed.getDate() === Number(match[3])
  );
}

function formatCustomRangeLabel(range: CustomReportDateFilter) {
  const from = range.fromDate || "";
  const to = range.toDate || "";
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "Not applied";
}

function selectedRangeLabel(rangeMode: ReportRangeMode, customRange: CustomReportDateFilter) {
  if (rangeMode === "custom") return formatCustomRangeLabel(customRange);
  if (rangeMode === "7d") return "Last 7 days";
  if (rangeMode === "30d") return "Last 30 days";
  if (rangeMode === "90d") return "Last 90 days";
  return "All time";
}

function formatPercent(value: number | undefined | null, total: number) {
  if (!total) return "0% of paid";
  const percent = (safeNumber(value) / total) * 100;
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}% of paid`;
}

function safeNumber(value: number | undefined | null) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizedPhoneNumber(value: string | undefined | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  const prefix = text.startsWith("+") ? "+" : "";
  const digits = text.replace(/[^\d]/g, "");
  return digits ? `${prefix}${digits}` : "";
}

function callPhoneNumber(phoneNumber: string) {
  Linking.openURL(`tel:${phoneNumber}`).catch(() => undefined);
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

const styles = StyleSheet.create({
  periodPanel: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  periodIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.purpleSoft
  },
  periodText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  periodLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  periodValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900"
  },
  refreshPill: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 10
  },
  refreshPillActive: {
    backgroundColor: colors.chip
  },
  refreshText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  refreshTextActive: {
    color: colors.primary
  },
  customPanel: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  customHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  detailHeader: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 10
  },
  backToReports: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.purpleSoft,
    paddingHorizontal: 10
  },
  backToReportsText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  detailTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  detailTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  detailSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between"
  },
  categoryCard: {
    width: "48%",
    minWidth: 156,
    flexGrow: 1,
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  categoryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  categoryIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.purpleSoft
  },
  categoryTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 19
  },
  categorySubtitle: {
    minHeight: 34,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  categoryMetric: {
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: "900"
  },
  section: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 2
  },
  sectionIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.purpleSoft
  },
  sectionTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  sectionSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  summaryCard: {
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#cfc6ff",
    backgroundColor: colors.purpleSoft,
    padding: 14
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  summaryIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: "#ffffff"
  },
  summaryLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900"
  },
  summaryValue: {
    color: colors.primaryDark,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0
  },
  summaryValueDanger: {
    color: colors.danger
  },
  summaryStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  summaryStat: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 128,
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: "#ffffff",
    padding: 10
  },
  summaryStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  summaryStatValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  defaultStat: {},
  successStat: {
    backgroundColor: colors.greenSoft
  },
  warningStat: {
    backgroundColor: colors.goldSoft
  },
  dangerStat: {
    backgroundColor: colors.redSoft
  },
  dateFieldRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  dateField: {
    flex: 1,
    minWidth: 128,
    gap: 5
  },
  dateLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  dateInput: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#ffffff",
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    paddingHorizontal: 10
  },
  applyButton: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: 12
  },
  applyButtonDisabled: {
    backgroundColor: colors.chip
  },
  applyButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900"
  },
  applyButtonTextDisabled: {
    color: colors.muted
  },
  dataRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10
  },
  dataRowEmphasis: {
    minHeight: 54
  },
  dueRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  rowSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16
  },
  amount: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    maxWidth: "46%",
    textAlign: "right"
  },
  defaultAmount: {},
  successAmount: {
    color: colors.success
  },
  warningAmount: {
    color: colors.warning
  },
  dangerAmount: {
    color: colors.danger
  },
  rankBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.chip
  },
  rankText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  dueIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surface
  },
  dueActions: {
    width: 104,
    alignItems: "flex-end",
    gap: 7
  },
  dueAmount: {
    maxWidth: "100%"
  },
  callButton: {
    minHeight: 34,
    minWidth: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: 10
  },
  callButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900"
  },
  stockValues: {
    width: 116,
    alignItems: "flex-end",
    gap: 2
  },
  overviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 2
  },
  overviewItem: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 112,
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  overviewValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900"
  },
  overviewLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  defaultOverview: {},
  successOverview: {
    backgroundColor: colors.greenSoft
  },
  warningOverview: {
    backgroundColor: colors.goldSoft
  },
  dangerOverview: {
    backgroundColor: colors.redSoft
  },
  breakdownBlock: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10
  },
  subListTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    paddingTop: 4
  },
  emptyInline: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  breakdownRow: {
    gap: 6
  },
  breakdownTop: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  breakdownCount: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900"
  },
  progressTrack: {
    height: 7,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: colors.surface
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.primary
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: 18
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center"
  },
  emptyDetail: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center"
  },
  errorPanel: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#f0bcbc",
    backgroundColor: colors.redSoft,
    padding: 12
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
