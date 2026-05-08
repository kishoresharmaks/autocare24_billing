import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import type { ReportData } from "../types/cloud";
import { formatMoney } from "../utils/format";

interface SalesTrendChartProps {
  points: ReportData["salesTrend"];
  compact?: boolean;
}

export function SalesTrendChart({ points, compact = false }: SalesTrendChartProps) {
  const visible = points.slice(-7);
  const max = Math.max(1, ...visible.map((point) => Math.max(Number(point.paidAmount || 0), Number(point.billedValue || 0))));
  const totals = visible.reduce(
    (summary, point) => ({
      billed: summary.billed + Number(point.billedValue || 0),
      paid: summary.paid + Number(point.paidAmount || 0)
    }),
    { billed: 0, paid: 0 }
  );

  if (!visible.length) return <Text style={styles.empty}>No sales trend available.</Text>;

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        <LegendItem color="#d9c49a" label="Billed" value={formatMoney(totals.billed)} />
        <LegendItem color={colors.primary} label="Paid" value={formatMoney(totals.paid)} />
      </View>
      <View style={[styles.chart, compact ? styles.chartCompact : null]}>
        {visible.map((point) => {
          const paidHeight = Math.max(6, (Number(point.paidAmount || 0) / max) * 100);
          const billedHeight = Math.max(6, (Number(point.billedValue || 0) / max) * 100);
          return (
            <View style={styles.day} key={point.date || point.label}>
              <View style={styles.bars}>
                <View style={[styles.bar, styles.billedBar, { height: `${billedHeight}%` }]} />
                <View style={[styles.bar, styles.paidBar, { height: `${paidHeight}%` }]} />
              </View>
              <Text style={styles.dateLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.74}>
                {formatTrendDate(point.date || point.label)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function LegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

function formatTrendDate(value: string | undefined | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short"
  });
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  legendItem: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#ffffff",
    paddingHorizontal: 9
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5
  },
  legendLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900"
  },
  legendValue: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: 118
  },
  chart: {
    height: 178,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 12
  },
  chartCompact: {
    height: 154
  },
  day: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 7,
    minWidth: 0
  },
  bars: {
    flex: 1,
    width: "100%",
    maxWidth: 26,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3
  },
  bar: {
    width: 9,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8
  },
  billedBar: {
    backgroundColor: "#d9c49a"
  },
  paidBar: {
    backgroundColor: colors.primary
  },
  dateLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
    width: "100%"
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  }
});
