import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AppButton } from "../../src/components/AppButton";
import { Screen } from "../../src/components/Screen";
import { StatusPill } from "../../src/components/StatusPill";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { colors } from "../../src/theme";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";

export default function SettingsTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const layout = useResponsiveLayout();

  if (guard) return guard;

  async function handleLogout() {
    await session.logoutOwner();
    router.replace("/login");
  }

  async function handleClear() {
    await session.clearLocalConnection();
    router.replace("/");
  }

  return (
    <Screen title="Settings" subtitle="Owner session and approved phone connection." showHome>
      <View style={styles.panel}>
        <StatusPill status={session.approvalStatus} />
        <Info label="Cloud API" value={session.cloudUrl} />
        <Info label="Phone name" value={session.deviceName} />
        <Info label="Phone code" value={session.device?.deviceCode || session.deviceCode} />
        <Info label="Owner user" value={session.user?.displayName || session.user?.username || "Not logged in"} />
        <Info label="Network" value={session.isOnline ? "Online" : "Offline"} />
      </View>
      <View style={[styles.actions, layout.isTablet ? styles.actionsWide : null]}>
        <AppButton label="Logout owner" onPress={handleLogout} variant="secondary" style={layout.isTablet ? styles.actionWide : undefined} />
        <AppButton label="Reset phone connection" onPress={handleClear} variant="danger" style={layout.isTablet ? styles.actionWide : undefined} />
      </View>
      <Text style={styles.note}>Logout clears the saved owner login on this phone. Reset phone connection removes the cloud token, approval status, and saved owner session.</Text>
    </Screen>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  info: {
    gap: 3,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  infoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  actions: {
    gap: 10
  },
  actionsWide: {
    flexDirection: "row"
  },
  actionWide: {
    flex: 1
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600"
  }
});
