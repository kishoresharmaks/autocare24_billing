import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

interface MetricCardProps {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

export function MetricCard({ label, value, tone = "default" }: MetricCardProps) {
  return (
    <View style={[styles.card, styles[tone]]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    minHeight: 88,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12,
    justifyContent: "space-between"
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  value: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    maxWidth: "100%"
  },
  default: {},
  success: {
    borderColor: "#9fd0bb"
  },
  warning: {
    borderColor: "#dfbd82"
  },
  danger: {
    borderColor: "#dc9d9d"
  },
  info: {
    borderColor: "#9ebde0"
  }
});
