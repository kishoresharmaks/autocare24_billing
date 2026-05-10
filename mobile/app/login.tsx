import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { OwnerLoginScreen } from "../src/screens/OwnerLoginScreen";
import { colors } from "../src/theme";
import { useSession } from "../src/providers/SessionProvider";

export default function LoginRoute() {
  const session = useSession();

  if (session.booting) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!session.token || session.approvalStatus !== "APPROVED") {
    return <Redirect href="/" />;
  }

  if (session.user) {
    return <Redirect href="/dashboard" />;
  }

  return <OwnerLoginScreen />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background
  }
});
