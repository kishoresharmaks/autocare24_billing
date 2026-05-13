import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Code2 } from "lucide-react-native";
import { MOBILE_DEVELOPER } from "../constants/appInfo";
import { colors, radius } from "../theme";

interface DeveloperCreditProps {
  compact?: boolean;
}

export function DeveloperCredit({ compact = false }: DeveloperCreditProps) {
  const openProfile = async () => {
    const supported = await Linking.canOpenURL(MOBILE_DEVELOPER.profileUrl);
    if (supported) await Linking.openURL(MOBILE_DEVELOPER.profileUrl);
  };

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void openProfile()}
      style={({ pressed }) => [styles.shell, compact ? styles.compactShell : null, pressed ? styles.pressed : null]}
    >
      <View style={[styles.iconBox, compact ? styles.compactIconBox : null]}>
        <Code2 color={colors.primary} size={compact ? 15 : 18} />
      </View>
      <View style={styles.textBlock}>
        <Text style={[styles.credit, compact ? styles.compactCredit : null]} numberOfLines={1}>
          {MOBILE_DEVELOPER.credit}
        </Text>
        {!compact ? (
          <Text style={styles.role} numberOfLines={2}>
            {MOBILE_DEVELOPER.role}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  compactShell: {
    minHeight: 42,
    alignSelf: "center",
    borderColor: "rgba(90, 63, 213, 0.18)",
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  iconBox: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.purpleSoft
  },
  compactIconBox: {
    width: 28,
    height: 28
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  credit: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900"
  },
  compactCredit: {
    fontSize: 12
  },
  role: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700"
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
