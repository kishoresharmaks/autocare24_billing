import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchReport } from "../../src/services/cloudApi";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { RangeSelector } from "../../src/components/RangeSelector";
import { Screen } from "../../src/components/Screen";
import { SalesTrendChart } from "../../src/components/SalesTrendChart";
import { colors } from "../../src/theme";
import type { DateRangePreset, InvoiceSummary, ReportDateFilter } from "../../src/types/cloud";
import { formatCount, formatMoney } from "../../src/utils/format";
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
      subtitle={reportQuery.data?.rangeLabel || "Cloud sales and GST view"}
      right={<RangeSelector<ReportRangeMode> value={rangeMode} onChange={setRangeMode} includeCustom />}
      refreshing={reportQuery.isFetching}
      onRefresh={reportQuery.refetch}
      showHome
    >
      {reportQuery.error ? <Text style={styles.error}>{reportQuery.error instanceof Error ? reportQuery.error.message : "Unable to load reports."}</Text> : null}
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
          {customDateError ? <Text style={styles.error}>{customDateError}</Text> : null}
        </View>
      ) : null}
      <MetricGrid>
        <MetricCard label="Revenue" value={formatMoney(reportQuery.data?.revenue)} tone="success" />
        <MetricCard label="Invoices" value={formatCount(reportQuery.data?.invoiceCount)} tone="info" />
        <MetricCard label="Paid" value={formatMoney(reportQuery.data?.paidAmount)} />
        <MetricCard label="Balance Due" value={formatMoney(reportQuery.data?.balanceDue)} tone="warning" />
        <MetricCard label="Taxable Value" value={formatMoney(reportQuery.data?.taxableValue)} />
        <MetricCard label="Total Tax" value={formatMoney(reportQuery.data?.totalTax)} />
      </MetricGrid>
      <View style={styles.section}>
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>Daily Sales Trend</Text>
          <Text style={styles.sectionSub}>Billed invoices vs paid collections</Text>
        </View>
        <SalesTrendChart points={reportQuery.data?.salesTrend || []} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top services</Text>
        {(reportQuery.data?.topServices || []).slice(0, 5).map((service: { name: string; quantity: number; revenue: number }) => (
          <View key={service.name} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {service.name}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {service.quantity} services
              </Text>
            </View>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {formatMoney(service.revenue)}
            </Text>
          </View>
        ))}
        {!reportQuery.isLoading && !reportQuery.data?.topServices?.length ? <Text style={styles.empty}>No services in this range.</Text> : null}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Payment modes</Text>
        {(reportQuery.data?.paymentModes || []).map((mode: { mode: string; amount: number }) => (
          <View key={mode.mode} style={styles.row}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {mode.mode}
            </Text>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {formatMoney(mode.amount)}
            </Text>
          </View>
        ))}
        {!reportQuery.isLoading && !reportQuery.data?.paymentModes?.length ? <Text style={styles.empty}>No payments in this range.</Text> : null}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pending dues</Text>
        {(reportQuery.data?.dues || []).slice(0, 5).map((invoice: InvoiceSummary) => (
          <View key={invoice.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {invoice.invoiceNumber || invoice.customerName}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {invoice.customerName || invoice.vehicleNumber || invoice.invoiceDate}
              </Text>
            </View>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {formatMoney(invoice.balanceDue)}
            </Text>
          </View>
        ))}
        {!reportQuery.isLoading && !reportQuery.data?.dues?.length ? <Text style={styles.empty}>No dues in this range.</Text> : null}
      </View>
    </Screen>
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

const styles = StyleSheet.create({
  customPanel: {
    gap: 10,
    borderRadius: 8,
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
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
    fontWeight: "700"
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
    borderRadius: 8,
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
    borderRadius: 8,
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
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee2d5",
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
    fontWeight: "600"
  },
  amount: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    maxWidth: "42%",
    textAlign: "right"
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700"
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
