import { StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { AppButton } from "../components/AppButton";
import { AuthLayout } from "../components/AuthLayout";
import { StatusPill } from "../components/StatusPill";
import { colors } from "../theme";
import { useSession } from "../providers/SessionProvider";

export function ApprovalScreen() {
  const session = useSession();
  const [checking, setChecking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  async function handleCheck() {
    setError("");
    setChecking(true);
    try {
      await session.refreshApproval();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to check approval.");
    } finally {
      setChecking(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await session.clearLocalConnection();
    } finally {
      setClearing(false);
    }
  }

  const revoked = session.approvalStatus === "REVOKED" || session.device?.isRevoked;

  return (
    <AuthLayout>
      <StatusPill status={session.approvalStatus || "PENDING"} />
      <Text style={styles.title} numberOfLines={2}>
        {revoked ? "Phone access revoked" : "Waiting for owner approval"}
      </Text>
      <Text style={styles.copy}>
        {revoked
          ? "This phone cannot view reports. Clear this connection and request access again if the owner allows it."
          : "Approve this phone from the owner PC under Settings > Cloud Status > Cloud Devices."}
      </Text>
      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>Phone code</Text>
        <Text style={styles.code} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {session.device?.deviceCode || session.deviceCode}
        </Text>
      </View>
      {!session.isOnline ? <Text style={styles.warning}>Phone is offline. Connect internet and try again.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!revoked ? <AppButton label="Check approval" onPress={handleCheck} loading={checking} /> : null}
      <AppButton label="Clear local connection" onPress={handleClear} loading={clearing} variant="secondary" />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "900"
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  codeBox: {
    borderRadius: 8,
    backgroundColor: colors.chip,
    padding: 12,
    gap: 4
  },
  codeLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  code: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900"
  },
  warning: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: "700"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700"
  }
});
