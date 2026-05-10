import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ChevronRight, CircleDollarSign, Cloud, LogOut, MonitorSmartphone, Settings, ShieldCheck } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Screen } from "../../src/components/Screen";
import { StatusPill } from "../../src/components/StatusPill";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import { colors, radius } from "../../src/theme";

type MoreRoute = "/profit" | "/devices" | "/settings";

export default function MoreTab() {
  const guard = useRequireOwner();
  const session = useSession();

  if (guard) return guard;

  async function handleLogout() {
    await session.logoutOwner();
    router.replace("/login");
  }

  return (
    <Screen title="More" subtitle="Owner tools and phone session">
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <ShieldCheck color={colors.primary} size={25} />
        </View>
        <View style={styles.profileText}>
          <Text style={styles.profileName} numberOfLines={1}>
            {session.user?.displayName || session.user?.username || "Owner"}
          </Text>
          <Text style={styles.profileSub} numberOfLines={1}>
            {session.device?.deviceCode || session.deviceCode || "Approved phone"}
          </Text>
        </View>
        <StatusPill status={session.approvalStatus} />
      </View>

      <View style={styles.list}>
        <MoreRow icon={CircleDollarSign} title="Profit & Expense" subtitle="Cash profit, margin, and expenses" route="/profit" />
        <MoreRow icon={MonitorSmartphone} title="Cloud Devices" subtitle="Approve or revoke owner phones" route="/devices" />
        <MoreRow icon={Settings} title="Settings" subtitle="Cloud URL, phone code, and reset tools" route="/settings" />
      </View>

      <View style={styles.networkCard}>
        <Cloud color={session.isOnline ? colors.success : colors.danger} size={20} />
        <View style={styles.networkText}>
          <Text style={styles.networkTitle}>{session.isOnline ? "Cloud reachable" : "Phone offline"}</Text>
          <Text style={styles.networkSub} numberOfLines={2}>
            {session.isOnline ? "Reports refresh from the approved cloud API." : "Saved login stays on this phone; cloud data refreshes when internet returns."}
          </Text>
        </View>
      </View>

      <Pressable accessibilityRole="button" onPress={() => void handleLogout()} style={({ pressed }) => [styles.logout, pressed ? styles.pressed : null]}>
        <LogOut color={colors.danger} size={18} />
        <Text style={styles.logoutText}>Logout owner</Text>
      </Pressable>
    </Screen>
  );
}

function MoreRow({ icon: Icon, title, subtitle, route }: { icon: LucideIcon; title: string; subtitle: string; route: MoreRoute }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(route)} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={styles.rowIcon}>
        <Icon color={colors.primary} size={22} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <ChevronRight color={colors.primary} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.purpleSoft
  },
  profileText: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  profileName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900"
  },
  profileSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  list: {
    gap: 10
  },
  row: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.purpleSoft
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  rowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  rowSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  networkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: 12
  },
  networkText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  networkTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  networkSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700"
  },
  logout: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#f0bcbc",
    backgroundColor: colors.redSoft
  },
  logoutText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "900"
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
