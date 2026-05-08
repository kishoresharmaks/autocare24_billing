import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { ApprovalScreen } from "../src/screens/ApprovalScreen";
import { OwnerLoginScreen } from "../src/screens/OwnerLoginScreen";
import { SetupScreen } from "../src/screens/SetupScreen";
import { colors } from "../src/theme";
import { useSession } from "../src/providers/SessionProvider";

export default function EntryScreen() {
  const session = useSession();

  if (session.booting) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!session.token) {
    return <SetupScreen />;
  }

  if (session.approvalStatus !== "APPROVED") {
    return <ApprovalScreen />;
  }

  if (!session.user) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/dashboard" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background
  }
});
