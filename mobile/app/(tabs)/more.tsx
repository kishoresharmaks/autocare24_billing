import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ChevronRight, CircleDollarSign, Cloud, LogOut, MonitorSmartphone, Settings, ShieldCheck } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { DeveloperCredit } from "../../src/components/DeveloperCredit";
import { Screen } from "../../src/components/Screen";
import { StatusPill } from "../../src/components/StatusPill";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import { hasPermission, readablePermissions } from "../../src/services/permissions";
import { colors, radius } from "../../src/theme";

type MoreRoute = "/profit" | "/devices" | "/settings";

export default function MoreTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const permissionLabels = readablePermissions(session.user).slice(0, 10);

  if (guard) return guard;

  async function handleLogout() {
    await session.logoutUser();
    router.replace("/login");
  }

  return (
    <Screen title="More" subtitle="Role, permissions, and phone session">
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <ShieldCheck color={colors.primary} size={25} />
        </View>
        <View style={styles.profileText}>
          <Text style={styles.profileName} numberOfLines={1}>
            {session.user?.displayName || session.user?.username || "User"}
          </Text>
          <Text style={styles.profileSub} numberOfLines={1}>
            {session.user?.accessRoleName || session.user?.role || "Cloud user"} | {session.device?.deviceCode || session.deviceCode || "Approved phone"}
          </Text>
        </View>
        <StatusPill status={session.approvalStatus} />
      </View>

      <View style={styles.permissionCard}>
        <Text style={styles.permissionTitle}>Granted permissions</Text>
        <View style={styles.permissionWrap}>
          {permissionLabels.length ? permissionLabels.map((label) => <Text key={label} style={styles.permissionChip}>{label}</Text>) : <Text style={styles.profileSub}>No permissions assigned.</Text>}
        </View>
      </View>

      <View style={styles.list}>
        {hasPermission(session.user, "reports.view") ? <MoreRow icon={CircleDollarSign} title="Profit & Expense" subtitle="Cash profit, margin, and expenses" route="/profit" /> : null}
        {hasPermission(session.user, "users.manage") ? <MoreRow icon={MonitorSmartphone} title="Cloud Devices" subtitle="Approve or revoke phones" route="/devices" /> : null}
        <MoreRow icon={Settings} title="Settings" subtitle="Cloud URL, phone code, and reset tools" route="/settings" />
      </View>

      <View style={styles.networkCard}>
        <Cloud color={session.isOnline ? colors.success : colors.danger} size={20} />
        <View style={styles.networkText}>
          <Text style={styles.networkTitle}>{session.isOnline ? "Cloud reachable" : "Phone offline"}</Text>
          <Text style={styles.networkSub} numberOfLines={2}>
            {session.isOnline ? "Allowed data refreshes from the approved cloud API." : "Saved login stays on this phone; cloud data refreshes when internet returns."}
          </Text>
        </View>
      </View>

      <DeveloperCredit />

      <Pressable accessibilityRole="button" onPress={() => void handleLogout()} style={({ pressed }) => [styles.logout, pressed ? styles.pressed : null]}>
        <LogOut color={colors.danger} size={18} />
        <Text style={styles.logoutText}>Logout user</Text>
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
  permissionCard: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  permissionTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900"
  },
  permissionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  permissionChip: {
    borderRadius: radius.pill,
    backgroundColor: colors.chip,
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 6
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
