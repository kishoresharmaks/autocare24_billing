import { PropsWithChildren, ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Home } from "lucide-react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { colors } from "../theme";

interface ScreenProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  showHome?: boolean;
}

export function Screen({ title, subtitle, right, refreshing = false, onRefresh, showHome = false, children }: ScreenProps) {
  const layout = useResponsiveLayout();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: layout.horizontalPadding,
            paddingTop: layout.verticalPadding,
            gap: layout.sectionGap,
            maxWidth: layout.contentMaxWidth
          }
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        <View style={[styles.header, layout.isCompact ? styles.headerCompact : null]}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {showHome || right ? (
            <View style={[styles.headerRight, layout.isCompact ? styles.headerRightCompact : null]}>
              {showHome ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.replace("/dashboard")}
                  style={({ pressed }) => [styles.homeButton, pressed ? styles.homeButtonPressed : null]}
                >
                  <Home color={colors.primaryDark} size={18} />
                  <Text style={styles.homeButtonText}>Home</Text>
                </Pressable>
              ) : null}
              {right}
            </View>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    width: "100%",
    alignSelf: "center",
    padding: 16,
    gap: 16,
    paddingBottom: 32
  },
  header: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "flex-start"
  },
  headerCompact: {
    flexDirection: "column"
  },
  headerText: {
    flex: 1,
    gap: 4
  },
  headerRight: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8
  },
  headerRightCompact: {
    width: "100%",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start"
  },
  homeButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 12
  },
  homeButtonPressed: {
    transform: [{ scale: 0.99 }]
  },
  homeButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900"
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
