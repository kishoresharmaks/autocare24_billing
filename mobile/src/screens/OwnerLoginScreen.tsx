import { StyleSheet, Text } from "react-native";
import { useState } from "react";
import { router } from "expo-router";
import { AppButton } from "../components/AppButton";
import { AuthLayout } from "../components/AuthLayout";
import { FormField } from "../components/FormField";
import { StatusPill } from "../components/StatusPill";
import { colors } from "../theme";
import { useSession } from "../providers/SessionProvider";
import { firstAllowedMobileRoute } from "../services/permissions";

export function OwnerLoginScreen() {
  const session = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setError("");
    setLoading(true);
    try {
      const user = await session.loginUser({ username, password });
      router.replace(firstAllowedMobileRoute(user));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <StatusPill status={session.approvalStatus} />
      <Text style={styles.title}>User login</Text>
      <Text style={styles.copy}>Login with any approved cloud user. This phone will show only the data allowed for that role.</Text>
      <FormField label="Username" value={username} onChangeText={setUsername} />
      <FormField label="Password / PIN" value={password} onChangeText={setPassword} secureTextEntry />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="Open dashboard" onPress={handleLogin} loading={loading} disabled={!username.trim() || !password} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "900"
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700"
  }
});
