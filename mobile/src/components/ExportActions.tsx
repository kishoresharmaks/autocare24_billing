import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { FileSpreadsheet, FileText } from "lucide-react-native";
import { colors, radius } from "../theme";
import type { ExportFormat } from "../services/reportExport";

interface ExportActionsProps {
  onExport: (format: ExportFormat) => Promise<void>;
  disabled?: boolean;
}

export function ExportActions({ onExport, disabled = false }: ExportActionsProps) {
  const [busyFormat, setBusyFormat] = useState<ExportFormat | "">("");

  async function run(format: ExportFormat) {
    if (disabled || busyFormat) return;
    setBusyFormat(format);
    try {
      await onExport(format);
    } catch (error) {
      Alert.alert("Unable to export report", error instanceof Error ? error.message : "Please refresh data and try again.");
    } finally {
      setBusyFormat("");
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled || Boolean(busyFormat)}
        onPress={() => void run("pdf")}
        style={({ pressed }) => [styles.button, styles.primaryButton, disabled || busyFormat ? styles.disabled : null, pressed ? styles.pressed : null]}
      >
        <FileText color="#ffffff" size={16} />
        <Text style={styles.primaryText}>{busyFormat === "pdf" ? "Preparing PDF..." : "Export PDF"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={disabled || Boolean(busyFormat)}
        onPress={() => void run("csv")}
        style={({ pressed }) => [styles.button, styles.secondaryButton, disabled || busyFormat ? styles.disabled : null, pressed ? styles.pressed : null]}
      >
        <FileSpreadsheet color={colors.primary} size={16} />
        <Text style={styles.secondaryText}>{busyFormat === "csv" ? "Preparing CSV..." : "Export CSV"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    gap: 8
  },
  button: {
    flex: 1,
    minHeight: 42,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: radius.md,
    paddingHorizontal: 10
  },
  primaryButton: {
    backgroundColor: colors.primary
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong
  },
  primaryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900"
  },
  secondaryText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900"
  },
  disabled: {
    opacity: 0.55
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
