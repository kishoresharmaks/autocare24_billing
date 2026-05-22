import { Image, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { AppButton } from "../components/AppButton";
import { AuthLayout } from "../components/AuthLayout";
import { FormField } from "../components/FormField";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { colors } from "../theme";
import { useSession } from "../providers/SessionProvider";

export function SetupScreen() {
  const session = useSession();
  const layout = useResponsiveLayout();
  const [cloudUrl, setCloudUrl] = useState(session.cloudUrl);
  const [deviceName, setDeviceName] = useState(session.deviceName);
  const [registrationKey, setRegistrationKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setError("");
    setLoading(true);
    try {
      await session.registerDevice({ cloudUrl, deviceName, registrationKey });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to request phone approval.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Image source={require("../../assets/autocare24-logo.png")} style={[styles.logo, layout.isNarrow ? styles.logoNarrow : null]} resizeMode="contain" />
      <View style={styles.headingBlock}>
        <Text style={styles.eyebrow}>Role-based mobile access</Text>
        <Text style={styles.title} numberOfLines={2}>
          Connect this phone
        </Text>
        <Text style={styles.copy}>Use the registration key once, then approve this phone from the desktop app.</Text>
      </View>
      <FormField label="Cloud API URL" value={cloudUrl} onChangeText={setCloudUrl} keyboardType="url" />
      <FormField label="Phone name" value={deviceName} onChangeText={setDeviceName} autoCapitalize="words" />
      <FormField label="Registration key" value={registrationKey} onChangeText={setRegistrationKey} secureTextEntry />
      <View style={styles.deviceCodeBox}>
        <Text style={styles.deviceCodeLabel}>Phone code</Text>
        <Text style={styles.deviceCode} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {session.deviceCode || "Loading"}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="Request phone approval" onPress={handleConnect} loading={loading} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: "100%",
    height: 76,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  logoNarrow: {
    height: 64
  },
  headingBlock: {
    gap: 4
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase"
  },
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
  deviceCodeBox: {
    borderRadius: 8,
    backgroundColor: colors.chip,
    padding: 12,
    gap: 4
  },
  deviceCodeLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  deviceCode: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700"
  }
});
