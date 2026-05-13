import { PropsWithChildren, ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, Home } from "lucide-react-native";
import { router, usePathname } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { colors, radius } from "../theme";

interface ScreenProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  showHome?: boolean;
  showBack?: boolean;
  hideHeader?: boolean;
  fixedFooter?: ReactNode;
}

export function Screen({
  title,
  subtitle,
  right,
  refreshing = false,
  onRefresh,
  showHome = true,
  showBack = true,
  hideHeader = false,
  fixedFooter,
  children
}: ScreenProps) {
  const layout = useResponsiveLayout();
  const pathname = usePathname();
  const isHomeRoute = pathname === "/" || pathname === "/dashboard";
  const canGoBack = router.canGoBack();
  const shouldShowBack = showBack && !isHomeRoute && canGoBack;
  const shouldShowHome = showHome && !isHomeRoute;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/dashboard");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: layout.horizontalPadding,
            paddingTop: hideHeader ? 10 : layout.verticalPadding,
            gap: layout.sectionGap,
            maxWidth: layout.contentMaxWidth,
            paddingBottom: fixedFooter ? 190 : 126
          }
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {!hideHeader ? (
          <View style={[styles.header, layout.isCompact ? styles.headerCompact : null]}>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {shouldShowBack || shouldShowHome || right ? (
              <View style={[styles.headerRight, layout.isCompact ? styles.headerRightCompact : null]}>
                {shouldShowBack || shouldShowHome ? (
                  <View style={styles.navigationActions}>
                    {shouldShowBack ? (
                      <Pressable
                        accessibilityLabel="Go back"
                        accessibilityRole="button"
                        onPress={handleBack}
                        style={({ pressed }) => [styles.navIconButton, pressed ? styles.navButtonPressed : null]}
                      >
                        <ChevronLeft color={colors.primary} size={20} />
                      </Pressable>
                    ) : null}
                    {shouldShowHome ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => router.replace("/dashboard")}
                        style={({ pressed }) => [styles.homeButton, pressed ? styles.navButtonPressed : null]}
                      >
                        <Home color={colors.primary} size={18} />
                        <Text style={styles.homeButtonText}>Home</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {right ? <View style={styles.customActions}>{right}</View> : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
      {fixedFooter ? (
        <View pointerEvents="box-none" style={styles.fixedFooterShell}>
          <View
            style={[
              styles.fixedFooterInner,
              {
                paddingHorizontal: layout.horizontalPadding,
                maxWidth: layout.contentMaxWidth
              }
            ]}
          >
            {fixedFooter}
          </View>
        </View>
      ) : null}
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
    gap: 16
  },
  fixedFooterShell: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: "center"
  },
  fixedFooterInner: {
    width: "100%"
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
  navigationActions: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8
  },
  customActions: {
    minWidth: 0
  },
  navIconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong
  },
  homeButton: {
    minWidth: 92,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 12
  },
  navButtonPressed: {
    transform: [{ scale: 0.99 }]
  },
  homeButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900"
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
