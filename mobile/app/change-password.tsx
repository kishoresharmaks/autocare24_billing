import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AppButton } from "../src/components/AppButton";
import { FormField } from "../src/components/FormField";
import { Screen } from "../src/components/Screen";
import { useRequireOwner } from "../src/hooks/useRequireOwner";
import { useSession } from "../src/providers/SessionProvider";
import { changeUserPassword } from "../src/services/cloudApi";
import { colors, radius } from "../src/theme";

const COMMON_PASSWORDS = new Set(["password", "password1", "password123", "admin123", "autocare123", "qwerty123", "welcome123"]);

export default function ChangePasswordScreen() {
  const guard = useRequireOwner();
  const session = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (guard) return guard;

  const canSubmit = Boolean(currentPassword && newPassword && confirmPassword && !loading);

  async function handleChangePassword() {
    setError("");
    const validationError = validateNewPassword(currentPassword, newPassword, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!session.user?.id || !session.token || !session.userToken) {
      setError("Login again before changing password.");
      return;
    }

    try {
      setLoading(true);
      await changeUserPassword(session.cloudUrl, session.token, session.userToken, {
        userId: session.user.id,
        currentPassword,
        newPassword
      });
      await session.logoutUser();
      Alert.alert("Password changed", "Login again with the new password.");
      router.replace("/login");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen title="Change Password" subtitle={session.user?.displayName || session.user?.username || "Cloud user"} showHome>
      <View style={styles.userCard}>
        <Text style={styles.userName} numberOfLines={1}>
          {session.user?.displayName || "Logged-in user"}
        </Text>
        <Text style={styles.userMeta} numberOfLines={1}>
          {session.user?.username || ""} | {session.user?.accessRoleName || session.user?.role || "Cloud role"}
        </Text>
      </View>

      <View style={styles.formCard}>
        <FormField label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <FormField label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <FormField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <AppButton label="Change password" onPress={() => void handleChangePassword()} loading={loading} disabled={!canSubmit} />
      </View>
    </Screen>
  );
}

function validateNewPassword(currentPassword: string, newPassword: string, confirmPassword: string) {
  if (!currentPassword) return "Current password is required.";
  if (newPassword !== confirmPassword) return "New passwords do not match.";
  if (newPassword.length < 8) return "New password must be at least 8 characters.";
  if (newPassword.length > 128) return "New password must be 128 characters or fewer.";
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return "New password must include at least one letter and one number.";
  if (/^(.)\1+$/.test(newPassword)) return "New password is too easy to guess.";
  if (COMMON_PASSWORDS.has(newPassword.toLowerCase())) return "New password is too common.";
  return "";
}

const styles = StyleSheet.create({
  userCard: {
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 14
  },
  userName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900"
  },
  userMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  formCard: {
    gap: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 14
  },
  errorText: {
    borderRadius: radius.md,
    backgroundColor: colors.redSoft,
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    padding: 10
  }
});
