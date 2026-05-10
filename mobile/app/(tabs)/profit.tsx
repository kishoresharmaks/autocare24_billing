import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchProfit } from "../../src/services/cloudApi";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { RangeSelector } from "../../src/components/RangeSelector";
import { Screen } from "../../src/components/Screen";
import { colors } from "../../src/theme";
import type { DateRangePreset, Expense } from "../../src/types/cloud";
import { formatDateTime, formatMoney } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";

export default function ProfitTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const profitQuery = useQuery({
    queryKey: ["profit", preset, session.cloudUrl, session.token],
    queryFn: () => fetchProfit(session.cloudUrl, session.token, preset),
    enabled: Boolean(session.user && session.token)
  });

  if (guard) return guard;

  return (
    <Screen
      title="Profit & Expense"
      subtitle={profitQuery.data?.rangeLabel || "Paid revenue minus stock cost and expenses"}
      right={<RangeSelector value={preset} onChange={setPreset} />}
      refreshing={profitQuery.isFetching}
      onRefresh={profitQuery.refetch}
      showHome
    >
      {profitQuery.error ? <Text style={styles.error}>{profitQuery.error instanceof Error ? profitQuery.error.message : "Unable to load profit."}</Text> : null}
      <MetricGrid>
        <MetricCard label="Cash Profit" value={formatMoney(profitQuery.data?.cashProfit)} tone={(profitQuery.data?.cashProfit || 0) >= 0 ? "success" : "danger"} />
        <MetricCard label="Margin" value={`${Number(profitQuery.data?.profitMargin || 0).toFixed(2)}%`} tone="info" />
        <MetricCard label="Paid Revenue" value={formatMoney(profitQuery.data?.paidRevenue)} />
        <MetricCard label="Stock Cost" value={formatMoney(profitQuery.data?.stockCost)} />
        <MetricCard label="Expenses" value={formatMoney(profitQuery.data?.expenseTotal)} tone="warning" />
      </MetricGrid>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Expense categories</Text>
        {(profitQuery.data?.expensesByCategory || []).slice(0, 6).map((category: { category: string; amount: number }) => (
          <View key={category.category} style={styles.row}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {category.category}
            </Text>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {formatMoney(category.amount)}
            </Text>
          </View>
        ))}
        {!profitQuery.isLoading && !profitQuery.data?.expensesByCategory?.length ? <Text style={styles.empty}>No expenses in this range.</Text> : null}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent expenses</Text>
        {(profitQuery.data?.expenses || []).slice(0, 8).map((expense: Expense) => (
          <View key={expense.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {expense.category || "Expense"}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {expense.vendor || formatDateTime(expense.expenseDate)}
              </Text>
            </View>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {formatMoney(expense.amount)}
            </Text>
          </View>
        ))}
        {!profitQuery.isLoading && !profitQuery.data?.expenses?.length ? <Text style={styles.empty}>No expense records in this range.</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
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
  }
});
