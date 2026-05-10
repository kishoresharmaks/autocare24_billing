import { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { colors, radius } from "../theme";

export function AuthLayout({ children }: PropsWithChildren) {
  const layout = useResponsiveLayout();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingHorizontal: layout.horizontalPadding,
              paddingVertical: layout.verticalPadding
            }
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.panel,
              {
                maxWidth: layout.authMaxWidth,
                padding: layout.isNarrow ? 14 : 18
              }
            ]}
          >
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  flex: {
    flex: 1
  },
  content: {
    flexGrow: 1,
    justifyContent: "center"
  },
  panel: {
    width: "100%",
    alignSelf: "center",
    gap: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    shadowColor: "#2f285f",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3
  }
});
