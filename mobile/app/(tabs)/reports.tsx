import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react-native";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
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
import { fetchReport } from "../../src/services/cloudApi";
import { RangeSelector } from "../../src/components/RangeSelector";
import { Screen } from "../../src/components/Screen";
import { colors, radius } from "../../src/theme";
import type { DateRangePreset, InvoiceSummary, ReportDateFilter } from "../../src/types/cloud";
import { formatCount, formatDate, formatMoney, titleCase } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";

type ReportRangeMode = DateRangePreset | "custom";
type CustomReportDateFilter = { fromDate: string; toDate: string; preset?: "" };

export default function ReportsTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const [rangeMode, setRangeMode] = useState<ReportRangeMode>("30d");
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
  const report = reportQuery.data;
  const paymentTotal = safeNumber(report?.paidAmount);

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

  return (
    <Screen
      title="Reports"
      subtitle="Complete sales, GST, dues, stock, enquiry and job-card view"
      right={<RangeSelector<ReportRangeMode> value={rangeMode} onChange={setRangeMode} includeCustom />}
      refreshing={reportQuery.isFetching}
      onRefresh={reportQuery.refetch}
      showHome
    >
      {reportQuery.error ? (
        <ErrorPanel message={reportQuery.error instanceof Error ? reportQuery.error.message : "Unable to load reports."} />
      ) : null}

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
        <View style={[styles.refreshPill, reportQuery.isFetching ? styles.refreshPillActive : null]}>
          <RefreshCcw color={reportQuery.isFetching ? colors.primary : colors.muted} size={14} />
          <Text style={[styles.refreshText, reportQuery.isFetching ? styles.refreshTextActive : null]}>
            {reportQuery.isFetching ? "Refreshing" : "Synced"}
          </Text>
        </View>
      </View>

      {rangeMode === "custom" ? (
        <View style={styles.customPanel}>
          <View style={styles.customHeader}>
            <View style={styles.sectionTitleWrap}>
              <Text style={styles.sectionTitle}>Custom Date Range</Text>
              <Text style={styles.sectionSub}>Applied: {formatCustomRangeLabel(appliedCustomRange)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(customDateError)}
              onPress={applyCustomRange}
              style={({ pressed }) => [styles.applyButton, customDateError ? styles.applyButtonDisabled : null, pressed ? styles.pressed : null]}
            >
              <Text style={[styles.applyButtonText, customDateError ? styles.applyButtonTextDisabled : null]}>Apply Dates</Text>
            </Pressable>
          </View>
          <View style={styles.dateFieldRow}>
            <DateInput label="From" value={draftFromDate} onChangeText={setDraftFromDate} />
            <DateInput label="To" value={draftToDate} onChangeText={setDraftToDate} />
          </View>
          {customDateError ? <Text style={styles.errorText}>{customDateError}</Text> : null}
        </View>
      ) : null}

      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryIcon}>
            <BarChart3 color={colors.primary} size={22} />
          </View>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.sectionTitle}>Business Summary</Text>
            <Text style={styles.sectionSub}>Invoice value and collections for the selected period</Text>
          </View>
        </View>
        <Text style={styles.summaryLabel}>Revenue</Text>
        <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(report?.revenue)}
        </Text>
        <View style={styles.summaryStats}>
          <SummaryStat label="Paid" value={formatMoney(report?.paidAmount)} tone="success" />
          <SummaryStat label="Balance Due" value={formatMoney(report?.balanceDue)} tone="warning" />
          <SummaryStat label="Invoices" value={formatCount(report?.invoiceCount)} />
          <SummaryStat label="Cancelled" value={formatCount(report?.cancelledCount)} tone="danger" />
        </View>
      </View>

      <ReportSection icon={Percent} title="GST Breakdown" subtitle="Taxable value and tax split">
        <DataRow label="Taxable Value" value={formatMoney(report?.taxableValue)} />
        <DataRow label="CGST" value={formatMoney(report?.cgst)} />
        <DataRow label="SGST" value={formatMoney(report?.sgst)} />
        <DataRow label="IGST" value={formatMoney(report?.igst)} />
        <DataRow label="Total Tax" value={formatMoney(report?.totalTax)} emphasis />
      </ReportSection>

      <ReportSection icon={CreditCard} title="Payment Modes" subtitle="Collections grouped by payment method">
        {(report?.paymentModes || []).map((mode) => (
          <DataRow key={mode.mode} label={titleCase(mode.mode)} value={formatMoney(mode.amount)} detail={formatPercent(mode.amount, paymentTotal)} />
        ))}
        {!reportQuery.isLoading && !report?.paymentModes?.length ? (
          <EmptyState icon={CreditCard} title="No payments in this range" detail="Collections will appear here when payments are synced." />
        ) : null}
      </ReportSection>

      <ReportSection icon={ReceiptText} title="Top Services" subtitle="Best performing services by billed value">
        {(report?.topServices || []).map((service, index) => (
          <RankedRow
            key={`${service.name}-${index}`}
            rank={index + 1}
            title={service.name || "Unnamed service"}
            subtitle={`${formatCount(service.quantity)} service(s)`}
            value={formatMoney(service.revenue)}
          />
        ))}
        {!reportQuery.isLoading && !report?.topServices?.length ? (
          <EmptyState icon={ReceiptText} title="No services in this range" detail="Final invoices with service lines will appear here." />
        ) : null}
      </ReportSection>

      <ReportSection icon={Wallet} title="Pending Dues" subtitle="All unpaid invoices returned by the report">
        {(report?.dues || []).map((invoice: InvoiceSummary) => (
          <DueRow key={invoice.id} invoice={invoice} />
        ))}
        {!reportQuery.isLoading && !report?.dues?.length ? (
          <EmptyState icon={Wallet} title="No pending dues" detail="Every invoice in this period is fully collected." />
        ) : null}
      </ReportSection>

      <ReportSection icon={Package} title="Inventory Snapshot" subtitle="Stock position included in the report response">
        <DataRow label="Stock Value" value={formatMoney(report?.inventory?.totalStockValue)} />
        <DataRow label="Low Stock Items" value={formatCount(report?.inventory?.lowStockCount)} tone={safeNumber(report?.inventory?.lowStockCount) > 0 ? "warning" : "default"} />
        <DataRow label="Expiring Batches" value={formatCount(report?.inventory?.expiringCount)} tone={safeNumber(report?.inventory?.expiringCount) > 0 ? "warning" : "default"} />
        <DataRow label="Retail Items" value={formatCount(report?.inventory?.retailCount)} />
      </ReportSection>

      <ReportSection icon={Users} title="Enquiries" subtitle="Lead status and source summary">
        <ActivityOverview
          items={[
            { label: "Total", value: formatCount(report?.enquiries?.total) },
            { label: "Open", value: formatCount(report?.enquiries?.open), tone: safeNumber(report?.enquiries?.open) > 0 ? "warning" : "default" },
            { label: "Converted", value: formatCount(report?.enquiries?.converted), tone: "success" },
            { label: "Lost", value: formatCount(report?.enquiries?.lost), tone: "danger" }
          ]}
        />
        <BreakdownList
          title="Status Breakdown"
          total={safeNumber(report?.enquiries?.total)}
          rows={(report?.enquiries?.byStatus || []).map((item) => ({ label: titleCase(item.status), count: item.count }))}
          emptyTitle="No enquiry status data"
        />
        <BreakdownList
          title="Source Breakdown"
          total={safeNumber(report?.enquiries?.total)}
          rows={(report?.enquiries?.bySource || []).map((item) => ({ label: titleCase(item.source || "Unknown"), count: item.count }))}
          emptyTitle="No enquiry source data"
        />
      </ReportSection>

      <ReportSection icon={ClipboardList} title="Job Cards" subtitle="Work status and billing conversion">
        <ActivityOverview
          items={[
            { label: "Total", value: formatCount(report?.jobCards?.total) },
            { label: "Open", value: formatCount(report?.jobCards?.open), tone: safeNumber(report?.jobCards?.open) > 0 ? "warning" : "default" },
            { label: "Running", value: formatCount(report?.jobCards?.inProgress) },
            { label: "Done", value: formatCount(report?.jobCards?.completed), tone: "success" }
          ]}
        />
        <ActivityOverview
          items={[
            {
              label: "Approval",
              value: formatCount(report?.jobCards?.approvalPending),
              tone: safeNumber(report?.jobCards?.approvalPending) > 0 ? "warning" : "default"
            },
            { label: "Billed", value: formatCount(report?.jobCards?.billed) },
            { label: "Cancelled", value: formatCount(report?.jobCards?.cancelled), tone: "danger" }
          ]}
        />
        <DataRow label="Billed Revenue" value={formatMoney(report?.jobCards?.billedRevenue)} emphasis />
        <DataRow label="Avg. Turnaround" value={`${formatCount(report?.jobCards?.averageTurnaroundDays)} day(s)`} />
        <BreakdownList
          title="Status Breakdown"
          total={safeNumber(report?.jobCards?.total)}
          rows={(report?.jobCards?.byStatus || []).map((item) => ({ label: titleCase(item.status), count: item.count }))}
          emptyTitle="No job-card status data"
        />
      </ReportSection>
    </Screen>
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
