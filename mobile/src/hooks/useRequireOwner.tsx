import { Redirect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Screen } from "../components/Screen";
import { useSession } from "../providers/SessionProvider";
import { hasAnyPermission, permissionLabel } from "../services/permissions";
import { colors, radius } from "../theme";

export function useRequirePermission(permissions?: string | string[]) {
  const session = useSession();
  if (!session.user) {
    return <Redirect href="/login" />;
  }
  const required = Array.isArray(permissions) ? permissions : permissions ? [permissions] : [];
  if (required.length && !hasAnyPermission(session.user, required)) {
    return <NoAccess permissions={required} roleName={session.user.accessRoleName || session.user.role} />;
  }
  return null;
}

export function useRequireOwner() {
  return useRequirePermission();
}

function NoAccess({ permissions, roleName }: { permissions: string[]; roleName: string }) {
  return (
    <Screen title="No access" subtitle="This role cannot open this section.">
      <View style={styles.card}>
        <Text style={styles.title}>No access for this role</Text>
        <Text style={styles.copy}>
          {roleName} does not have {permissions.map(permissionLabel).join(" or ")} permission.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
