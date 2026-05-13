import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchInvoices } from "../../src/services/cloudApi";
import { ExportActions } from "../../src/components/ExportActions";
import { FormField } from "../../src/components/FormField";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { Screen } from "../../src/components/Screen";
import { colors } from "../../src/theme";
import { exportInvoicesDocument, type ExportFormat } from "../../src/services/reportExport";
import { formatCount, formatDate, formatMoney, titleCase } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import type { InvoiceSummary } from "../../src/types/cloud";

const SEARCH_DEBOUNCE_MS = 300;

export default function InvoicesTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const invoicesQuery = useQuery({
    queryKey: ["invoices", session.cloudUrl, session.token, debouncedQuery],
    queryFn: () => fetchInvoices(session.cloudUrl, session.token, debouncedQuery),
    enabled: Boolean(session.user && session.token && session.approvalStatus === "APPROVED")
  });

  const invoices = invoicesQuery.data || [];
  const totals = useMemo(
    () =>
      invoices.reduce(
        (summary, invoice) => {
          const cancelled = invoice.invoiceStatus === "cancelled";
          summary.count += 1;
          if (!cancelled) {
            summary.total += Number(invoice.grandTotal || 0);
            summary.balance += Number(invoice.balanceDue || 0);
          }
          if (cancelled) summary.cancelled += 1;
          return summary;
        },
        { count: 0, total: 0, balance: 0, cancelled: 0 }
      ),
    [invoices]
  );

  if (guard) return guard;

  const approvalError =
    session.approvalStatus && session.approvalStatus !== "APPROVED"
      ? "This phone is not approved for cloud invoice viewing. Check approval status from Settings."
      : "";

  async function exportInvoices(format: ExportFormat) {
    if (approvalError) throw new Error(approvalError);
    if (invoicesQuery.error) throw new Error("Refresh invoices before exporting.");
    await exportInvoicesDocument({ invoices, query: debouncedQuery, totals, format });
  }

  return (
    <Screen
      title="Invoices"
      subtitle="Search and view synced cloud invoices."
      refreshing={invoicesQuery.isFetching}
      onRefresh={invoicesQuery.refetch}
      showHome
    >
      {approvalError ? <Text style={styles.error}>{approvalError}</Text> : null}
      {invoicesQuery.error ? (
        <Text style={styles.error}>{invoicesQuery.error instanceof Error ? invoicesQuery.error.message : "Unable to load invoices."}</Text>
      ) : null}
      <ExportActions disabled={Boolean(approvalError || invoicesQuery.error) || invoicesQuery.isFetching} onExport={exportInvoices} />
      <FormField
        label="Search invoices"
        onChangeText={setQuery}
        placeholder="Invoice, customer, phone, vehicle"
        value={query}
      />
      <MetricGrid>
        <MetricCard label="Invoices" value={formatCount(totals.count)} tone="info" />
        <MetricCard label="Total Value" value={formatMoney(totals.total)} tone="success" />
        <MetricCard label="Balance Due" value={formatMoney(totals.balance)} tone={totals.balance > 0 ? "warning" : "default"} />
      </MetricGrid>
      <FlatList<InvoiceSummary>
        data={invoices}
        keyExtractor={(item: InvoiceSummary) => item.id}
        onRefresh={invoicesQuery.refetch}
        refreshing={invoicesQuery.isFetching}
        scrollEnabled={false}
        renderItem={({ item }: { item: InvoiceSummary }) => <InvoiceCard invoice={item} />}
        ListEmptyComponent={!invoicesQuery.isLoading ? <Text style={styles.empty}>No invoices found.</Text> : null}
        contentContainerStyle={styles.list}
      />
    </Screen>
  );
}

function InvoiceCard({ invoice }: { invoice: InvoiceSummary }) {
  const status = titleCase(invoice.invoiceStatus || invoice.paymentStatus);
  const vehicleLabel = [invoice.vehicleNumber, invoice.vehicleType ? titleCase(invoice.vehicleType) : ""].filter(Boolean).join(" | ");
  const statusTone = invoice.invoiceStatus === "cancelled" ? styles.cancelled : invoice.balanceDue > 0 ? styles.due : styles.paid;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: invoice.id } })}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.titleWrap}>
          <Text style={styles.invoiceNumber} numberOfLines={1}>
            {invoice.invoiceNumber || "Invoice"}
          </Text>
          <Text style={styles.dateText}>{formatDate(invoice.invoiceDate || invoice.createdAt)}</Text>
        </View>
        <Text style={[styles.status, statusTone]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {status}
        </Text>
      </View>
      <View style={styles.identityBlock}>
        <Text style={styles.customer} numberOfLines={2}>
          {invoice.customerName || "Customer not available"}
        </Text>
        <Text style={styles.vehicle} numberOfLines={1}>
          {vehicleLabel || "Vehicle not available"}
        </Text>
      </View>
      <View style={styles.amountGrid}>
        <Amount label="Total" value={formatMoney(invoice.grandTotal)} />
        <Amount label="Paid" value={formatMoney(invoice.paidAmount)} />
        <Amount label="Balance" value={formatMoney(invoice.balanceDue)} emphasis={invoice.balanceDue > 0} />
      </View>
    </Pressable>
  );
}

function Amount({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.amountBox}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={[styles.amountValue, emphasis ? styles.amountEmphasis : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12
  },
  card: {
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  cardPressed: {
    transform: [{ scale: 0.99 }]
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  invoiceNumber: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  dateText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  status: {
    maxWidth: "40%",
    borderRadius: 8,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: "900"
  },
  paid: {
    backgroundColor: colors.greenSoft,
    color: colors.success
  },
  due: {
    backgroundColor: colors.goldSoft,
    color: colors.warning
  },
  cancelled: {
    backgroundColor: colors.redSoft,
    color: colors.danger
  },
  identityBlock: {
    gap: 3
  },
  customer: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  vehicle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  amountGrid: {
    flexDirection: "row",
    gap: 8
  },
  amountBox: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 8
  },
  amountLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  amountValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900"
  },
  amountEmphasis: {
    color: colors.warning
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
  }
});
