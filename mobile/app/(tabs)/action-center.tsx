import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, MonitorSmartphone, Package, TrendingDown, Wallet, X } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Screen } from "../../src/components/Screen";
import {
  buildActionItems,
  dismissActionForToday,
  filterVisibleActionItems,
  loadDismissedActionIds,
  type ActionItem,
  type ActionItemSeverity,
  type ActionItemType
} from "../../src/services/actionCenter";
import { fetchDevices, fetchInventoryDashboard, fetchInvoices, fetchProfit, fetchReport } from "../../src/services/cloudApi";
import { useRequirePermission } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import { hasAnyPermission, hasPermission } from "../../src/services/permissions";
import { colors, radius } from "../../src/theme";
import type { DateRangePreset } from "../../src/types/cloud";

const actionPreset: DateRangePreset = "30d";

export default function ActionCenterTab() {
  const guard = useRequirePermission(["reports.view", "stock.view", "billing.view", "users.manage"]);
  const session = useSession();
  const canReports = hasPermission(session.user, "reports.view");
  const canStock = hasPermission(session.user, "stock.view");
  const canBilling = hasPermission(session.user, "billing.view");
  const canUsers = hasPermission(session.user, "users.manage");
  const canViewActions = hasAnyPermission(session.user, ["reports.view", "stock.view", "billing.view", "users.manage"]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    loadDismissedActionIds()
      .then((ids) => {
        if (active) setDismissedIds(ids);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const reportQuery = useQuery({
    queryKey: ["report", actionPreset, session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchReport(session.cloudUrl, session.token, session.userToken, actionPreset),
    enabled: Boolean(session.user && session.token && session.userToken && canReports)
  });
  const profitQuery = useQuery({
    queryKey: ["profit", actionPreset, session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchProfit(session.cloudUrl, session.token, session.userToken, actionPreset),
    enabled: Boolean(session.user && session.token && session.userToken && canReports)
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory-dashboard", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchInventoryDashboard(session.cloudUrl, session.token, session.userToken),
    enabled: Boolean(session.user && session.token && session.userToken && canStock)
  });
  const invoicesQuery = useQuery({
    queryKey: ["invoices", session.cloudUrl, session.token, session.userToken, ""],
    queryFn: () => fetchInvoices(session.cloudUrl, session.token, session.userToken, ""),
    enabled: Boolean(session.user && session.token && session.userToken && canBilling && session.approvalStatus === "APPROVED")
  });
  const devicesQuery = useQuery({
    queryKey: ["devices-summary", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchDevices(session.cloudUrl, session.token, session.userToken),
    enabled: Boolean(session.user && session.token && session.userToken && canUsers)
  });

  const firstError = [reportQuery.error, profitQuery.error, inventoryQuery.error, invoicesQuery.error, devicesQuery.error].find(Boolean);
  const isRefreshing = reportQuery.isFetching || profitQuery.isFetching || inventoryQuery.isFetching || invoicesQuery.isFetching || devicesQuery.isFetching;
  const allActions = useMemo(
    () =>
      buildActionItems({
        report: reportQuery.data,
        inventory: inventoryQuery.data,
        profit: profitQuery.data,
        devices: devicesQuery.data,
        isOnline: session.isOnline,
        hasCloudError: Boolean(firstError && canViewActions)
      }),
    [canViewActions, devicesQuery.data, firstError, inventoryQuery.data, profitQuery.data, reportQuery.data, session.isOnline]
  );
  const visibleActions = useMemo(() => filterVisibleActionItems(allActions, dismissedIds), [allActions, dismissedIds]);
  const hiddenCount = Math.max(0, allActions.length - visibleActions.length);

  if (guard) return guard;

  async function refreshAll() {
    const refreshes: Array<Promise<unknown>> = [];
    if (canReports) refreshes.push(reportQuery.refetch(), profitQuery.refetch());
    if (canStock) refreshes.push(inventoryQuery.refetch());
    if (canBilling) refreshes.push(invoicesQuery.refetch());
    if (canUsers) refreshes.push(devicesQuery.refetch());
    await Promise.all(refreshes);
  }

  async function hideToday(item: ActionItem) {
    if (!item.dismissible) return;
    const next = await dismissActionForToday(item.id);
    setDismissedIds(next);
  }

  return (
    <Screen
      title="Action Center"
      subtitle={visibleActions.length ? `${visibleActions.length} item(s) need attention` : "No urgent action right now"}
      refreshing={isRefreshing}
      onRefresh={refreshAll}
      showHome
    >
      {firstError ? (
        <Text style={styles.error}>{firstError instanceof Error ? firstError.message : "Some action center values could not be refreshed."}</Text>
      ) : null}

      <View style={styles.summaryCard}>
        <View style={styles.summaryIcon}>
          {visibleActions.length ? <AlertTriangle color={colors.warning} size={26} /> : <CheckCircle2 color={colors.success} size={26} />}
        </View>
        <View style={styles.summaryText}>
          <Text style={styles.summaryTitle}>{visibleActions.length ? "Review today’s business actions" : "All clear for now"}</Text>
          <Text style={styles.summarySub} numberOfLines={2}>
            {visibleActions.length
              ? "Dues, stock, profit, devices, and cloud health are grouped here."
              : "No dues, stock, device, profit, or cloud warnings are currently visible."}
          </Text>
        </View>
      </View>

      {visibleActions.length ? (
        <View style={styles.actionList}>
          {visibleActions.map((item) => (
            <ActionCard key={item.id} item={item} onHide={() => void hideToday(item)} />
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <CheckCircle2 color={colors.success} size={64} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No Actions Pending</Text>
          <Text style={styles.emptySub}>When dues, low stock, pending devices, profit loss, or cloud issues appear, they will show here.</Text>
        </View>
      )}

      {hiddenCount ? <Text style={styles.hiddenNote}>{hiddenCount} dismissible item(s) hidden for today.</Text> : null}
    </Screen>
  );
}

function ActionCard({ item, onHide }: { item: ActionItem; onHide: () => void }) {
  const Icon = iconForAction(item.type);
  return (
    <View style={[styles.actionCard, severityStyle(item.severity)]}>
      <Pressable accessibilityRole="button" onPress={() => router.push(item.route)} style={({ pressed }) => [styles.actionMain, pressed ? styles.pressed : null]}>
        <View style={[styles.actionIcon, severityIconStyle(item.severity)]}>
          <Icon color={severityColor(item.severity)} size={22} />
        </View>
        <View style={styles.actionText}>
          <Text style={styles.actionTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.actionDetail} numberOfLines={2}>
            {item.detail}
          </Text>
          <Text style={styles.actionSource} numberOfLines={1}>
            {sourceLabel(item.createdFrom)}
          </Text>
        </View>
        <Text style={styles.openText}>Open</Text>
      </Pressable>
      {item.dismissible ? (
        <Pressable accessibilityRole="button" onPress={onHide} style={({ pressed }) => [styles.hideButton, pressed ? styles.pressed : null]}>
          <X color={colors.muted} size={14} />
          <Text style={styles.hideText}>Hide today</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function iconForAction(type: ActionItemType): LucideIcon {
  if (type === "dues") return Wallet;
  if (type === "lowStock" || type === "expiringStock") return Package;
  if (type === "pendingDevices") return MonitorSmartphone;
  if (type === "profitWarning") return TrendingDown;
  return CloudOff;
}

function sourceLabel(source: string) {
  if (source === "reports") return "Reports";
  if (source === "inventory") return "Inventory";
  if (source === "devices") return "Cloud devices";
  if (source === "profit") return "Profit";
  return "Cloud status";
}

function severityColor(severity: ActionItemSeverity) {
  if (severity === "critical") return colors.danger;
  if (severity === "warning") return colors.warning;
  return colors.info;
}

function severityStyle(severity: ActionItemSeverity) {
  if (severity === "critical") return styles.criticalCard;
  if (severity === "warning") return styles.warningCard;
  return styles.infoCard;
}

function severityIconStyle(severity: ActionItemSeverity) {
  if (severity === "critical") return styles.criticalIcon;
  if (severity === "warning") return styles.warningIcon;
  return styles.infoIcon;
}

const styles = StyleSheet.create({
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800"
  },
  summaryCard: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  summaryIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.goldSoft
  },
  summaryText: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  summarySub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700"
  },
  actionList: {
    gap: 10
  },
  actionCard: {
    overflow: "hidden",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong
  },
  criticalCard: {
    borderColor: "#f0bcbc"
  },
  warningCard: {
    borderColor: "#efd49a"
  },
  infoCard: {
    borderColor: "#c7dcf3"
  },
  actionMain: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  criticalIcon: {
    backgroundColor: colors.redSoft
  },
  warningIcon: {
    backgroundColor: colors.goldSoft
  },
  infoIcon: {
    backgroundColor: colors.blueSoft
  },
  actionText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  actionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  actionDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700"
  },
  actionSource: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900"
  },
  openText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  hideButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface
  },
  hideText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  emptyState: {
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  emptySub: {
    maxWidth: 290,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    fontWeight: "700"
  },
  hiddenNote: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    fontWeight: "800"
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
