import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

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
    borderRadius: radius.md,
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
    borderColor: "#bfe6ce",
    backgroundColor: colors.greenSoft
  },
  warning: {
    borderColor: "#efd49a",
    backgroundColor: colors.goldSoft
  },
  danger: {
    borderColor: "#f0bcbc",
    backgroundColor: colors.redSoft
  },
  info: {
    borderColor: "#c7dcf3",
    backgroundColor: colors.blueSoft
  }
});
