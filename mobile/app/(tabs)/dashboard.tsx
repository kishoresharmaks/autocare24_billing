import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  CircleDollarSign,
  FileText,
  LogOut,
  MonitorSmartphone,
  Package,
  Plus,
  RefreshCw,
  ReceiptText,
  Settings,
  Wallet
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import {
  fetchDevices,
  fetchInventoryDashboard,
  fetchInvoices,
  fetchProfit,
  fetchReport,
  isVisibleCloudDevice,
  summarizeDeviceStatus
} from "../../src/services/cloudApi";
import { Screen } from "../../src/components/Screen";
import { StatusPill } from "../../src/components/StatusPill";
import { buildActionItems, filterVisibleActionItems, loadDismissedActionIds, type ActionItem } from "../../src/services/actionCenter";
import { colors, radius } from "../../src/theme";
import type { DateRangePreset, InvoiceSummary } from "../../src/types/cloud";
import { formatCount, formatDate, formatMoney } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";

const dashboardPreset: DateRangePreset = "30d";
const weekPreset: DateRangePreset = "7d";

type DashboardRoute = "/action-center" | "/reports" | "/profit" | "/stock" | "/invoices" | "/devices" | "/settings";
type TileTone = "green" | "red" | "blue" | "purple" | "gold" | "plain";

export default function DashboardTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const [quickOpen, setQuickOpen] = useState(false);
  const [dismissedActionIds, setDismissedActionIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    loadDismissedActionIds()
      .then((ids) => {
        if (active) setDismissedActionIds(ids);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const reportQuery = useQuery({
    queryKey: ["report", dashboardPreset, session.cloudUrl, session.token],
    queryFn: () => fetchReport(session.cloudUrl, session.token, dashboardPreset),
    enabled: Boolean(session.user && session.token)
  });
  const weekReportQuery = useQuery({
    queryKey: ["report", weekPreset, session.cloudUrl, session.token],
    queryFn: () => fetchReport(session.cloudUrl, session.token, weekPreset),
    enabled: Boolean(session.user && session.token)
  });
  const profitQuery = useQuery({
    queryKey: ["profit", dashboardPreset, session.cloudUrl, session.token],
    queryFn: () => fetchProfit(session.cloudUrl, session.token, dashboardPreset),
    enabled: Boolean(session.user && session.token)
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory-dashboard", session.cloudUrl, session.token],
    queryFn: () => fetchInventoryDashboard(session.cloudUrl, session.token),
    enabled: Boolean(session.user && session.token)
  });
  const invoicesQuery = useQuery({
    queryKey: ["invoices", session.cloudUrl, session.token, ""],
    queryFn: () => fetchInvoices(session.cloudUrl, session.token, ""),
    enabled: Boolean(session.user && session.token && session.approvalStatus === "APPROVED")
  });
  const devicesQuery = useQuery({
    queryKey: ["devices-summary", session.cloudUrl, session.token, session.ownerCredentials?.username],
    queryFn: () =>
      fetchDevices(
        session.cloudUrl,
        session.token,
        session.ownerCredentials?.username || "",
        session.ownerCredentials?.password || ""
      ),
    enabled: Boolean(session.user && session.token && session.ownerCredentials)
  });

  const report = reportQuery.data;
  const weekReport = weekReportQuery.data;
  const profit = profitQuery.data;
  const inventory = inventoryQuery.data;
  const invoices = invoicesQuery.data || [];
  const isRefreshing =
    reportQuery.isFetching || weekReportQuery.isFetching || profitQuery.isFetching || inventoryQuery.isFetching || invoicesQuery.isFetching || devicesQuery.isFetching;

  const transactions = useMemo(() => {
    return [...invoices]
      .sort((left, right) => {
        const leftDue = Number(left.balanceDue || 0) > 0 ? 1 : 0;
        const rightDue = Number(right.balanceDue || 0) > 0 ? 1 : 0;
        if (leftDue !== rightDue) return rightDue - leftDue;
        return new Date(right.invoiceDate || right.createdAt || 0).getTime() - new Date(left.invoiceDate || left.createdAt || 0).getTime();
      })
      .slice(0, 6);
  }, [invoices]);

  const visibleDevices = (devicesQuery.data?.devices || []).filter(isVisibleCloudDevice);
  const deviceSummary = devicesQuery.data
    ? summarizeDeviceStatus(visibleDevices)
    : {
        total: session.approvalStatus ? 1 : 0,
        approved: session.approvalStatus === "APPROVED" ? 1 : 0,
        pending: session.approvalStatus === "PENDING" ? 1 : 0
      };
  const firstError = [reportQuery.error, weekReportQuery.error, profitQuery.error, inventoryQuery.error, invoicesQuery.error, devicesQuery.error].find(Boolean);
  const allActionItems = useMemo(
    () =>
      buildActionItems({
        report,
        inventory,
        profit,
        devices: devicesQuery.data,
        isOnline: session.isOnline,
        hasCloudError: Boolean(firstError)
      }),
    [devicesQuery.data, firstError, inventory, profit, report, session.isOnline]
  );
  const visibleActionItems = useMemo(() => filterVisibleActionItems(allActionItems, dismissedActionIds), [allActionItems, dismissedActionIds]);

  if (guard) return guard;

  async function refreshAll() {
    const refreshes: Array<Promise<unknown>> = [
      reportQuery.refetch(),
      weekReportQuery.refetch(),
      profitQuery.refetch(),
      inventoryQuery.refetch(),
      invoicesQuery.refetch()
    ];
    if (session.ownerCredentials) refreshes.push(devicesQuery.refetch());
    await Promise.all(refreshes);
  }

  const quickFooter = (
    <View style={styles.quickFooter}>
      {quickOpen ? (
        <View style={styles.quickSheet}>
          <QuickSheetItem icon={ClipboardList} label="Action Center" route="/action-center" />
          <QuickSheetItem icon={RefreshCw} label="Refresh all" onPress={() => void refreshAll()} />
          <QuickSheetItem icon={Wallet} label="Pending dues" route="/reports" />
          <QuickSheetItem icon={LogOut} label="Logout owner" onPress={() => void logoutOwner()} tone="danger" />
        </View>
      ) : null}
      <View style={styles.quickBar}>
        <Pressable accessibilityRole="button" onPress={() => router.push("/reports")} style={({ pressed }) => [styles.quickButton, styles.quickButtonDark, pressed ? styles.pressed : null]}>
          <Text style={styles.quickButtonDarkText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
            View Dues
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setQuickOpen((value) => !value)} style={({ pressed }) => [styles.plusButton, pressed ? styles.pressed : null]}>
          <Plus color="#ffffff" size={28} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push("/invoices")} style={({ pressed }) => [styles.quickButton, styles.quickButtonPrimary, pressed ? styles.pressed : null]}>
          <Text style={styles.quickButtonPrimaryText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
            Search Invoices
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Screen title="Dashboard" hideHeader refreshing={isRefreshing} onRefresh={refreshAll} fixedFooter={quickFooter}>
      <View style={styles.header}>
        <View style={styles.brandButton}>
          <View style={styles.brandText}>
            <Text style={styles.brandName} numberOfLines={1}>
              Autocare24
            </Text>
            <Text style={styles.brandSub} numberOfLines={1}>
              {session.user?.displayName || session.user?.username || "Owner dashboard"}
            </Text>
          </View>
        </View>
        <IconButton icon={Settings} route="/settings" label="Settings" />
      </View>

      {firstError ? (
        <Text style={styles.error}>{firstError instanceof Error ? firstError.message : "Some dashboard values could not be refreshed."}</Text>
      ) : null}

      <View style={styles.kpiGrid}>
        <KpiTile title="To Collect" value={formatMoney(report?.balanceDue)} subtitle="Pending dues" icon={Wallet} route="/reports" tone="green" />
        <KpiTile title="Expenses" value={formatMoney(profit?.expenseTotal)} subtitle="This period" icon={FileText} route="/profit" tone="red" />
        <KpiTile title="Stock Value" value={formatMoney(inventory?.totalStockValue)} subtitle="Value of items" icon={Package} tone="blue" />
        <KpiTile title="This Week Sale" value={formatMoney(weekReport?.revenue)} subtitle="Last 7 days" icon={ReceiptText} tone="blue" />
        <KpiTile
          title="Cash Profit"
          value={formatMoney(profit?.cashProfit)}
          subtitle="Paid revenue less costs"
          icon={CircleDollarSign}
          route="/profit"
          tone={(profit?.cashProfit || 0) >= 0 ? "plain" : "red"}
        />
        <KpiTile title="Invoices" value={formatCount(report?.invoiceCount)} subtitle="Final bills" icon={BarChart3} tone="purple" />
      </View>

      <ActionSummary actions={visibleActionItems.slice(0, 3)} totalCount={visibleActionItems.length} />

      <Pressable accessibilityRole="button" onPress={() => router.push("/devices")} style={({ pressed }) => [styles.deviceRow, pressed ? styles.pressed : null]}>
        <View style={styles.deviceIcon}>
          <MonitorSmartphone color={colors.primary} size={22} />
        </View>
        <View style={styles.deviceText}>
          <Text style={styles.deviceTitle} numberOfLines={1}>
            Manage multiple devices
          </Text>
          <Text style={styles.deviceSub} numberOfLines={1}>
            {formatCount(deviceSummary.approved)} approved, {formatCount(deviceSummary.pending)} pending
          </Text>
        </View>
        <StatusPill status={session.approvalStatus} />
        <ChevronRight color={colors.primary} size={20} />
      </Pressable>

      <View style={styles.transactionsHeader}>
        <View>
          <Text style={styles.sectionTitle}>Transactions</Text>
          <Text style={styles.sectionSub}>Recent synced invoices</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push("/reports")} style={({ pressed }) => [styles.rangeButton, pressed ? styles.pressed : null]}>
          <CalendarDays color={colors.primary} size={18} />
          <Text style={styles.rangeText}>LAST 30 DAYS</Text>
        </Pressable>
      </View>

      <View style={styles.transactionPanel}>
        {transactions.map((invoice) => (
          <TransactionRow key={invoice.id} invoice={invoice} />
        ))}
        {!transactions.length ? (
          <View style={styles.emptyState}>
            <CalendarDays color="#d8d7df" size={74} strokeWidth={1.4} />
            <Text style={styles.emptyTitle}>No Transactions Found</Text>
            <Text style={styles.emptySub}>Synced cloud invoices will appear here after billing starts.</Text>
          </View>
        ) : null}
      </View>

    </Screen>
  );

  async function logoutOwner() {
    setQuickOpen(false);
    await session.logoutOwner();
    router.replace("/login");
  }
}

function ActionSummary({ actions, totalCount }: { actions: ActionItem[]; totalCount: number }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push("/action-center")} style={({ pressed }) => [styles.actionSummary, pressed ? styles.pressed : null]}>
      <View style={styles.actionSummaryTop}>
        <View style={styles.actionSummaryTitleWrap}>
          <Text style={styles.actionSummaryTitle}>Today's actions</Text>
          <Text style={styles.actionSummarySub} numberOfLines={1}>
            {totalCount ? `${totalCount} item(s) need attention` : "No urgent action right now"}
          </Text>
        </View>
        <View style={styles.actionSummaryBadge}>
          <ClipboardList color={colors.primary} size={18} />
          <Text style={styles.actionSummaryBadgeText}>Open</Text>
        </View>
      </View>
      {actions.length ? (
        <View style={styles.actionMiniList}>
          {actions.map((item) => (
            <View key={item.id} style={styles.actionMiniRow}>
              <View style={[styles.actionDot, item.severity === "critical" ? styles.actionDotCritical : item.severity === "warning" ? styles.actionDotWarning : styles.actionDotInfo]} />
              <Text style={styles.actionMiniText} numberOfLines={1}>
                {item.title}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.actionClearText}>Dues, stock, devices, profit, and cloud health look clear.</Text>
      )}
    </Pressable>
  );
}

function IconButton({ icon: Icon, route, label }: { icon: LucideIcon; route: DashboardRoute; label: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={() => router.push(route)} style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}>
      <Icon color={colors.primary} size={22} />
    </Pressable>
  );
}

function KpiTile({
  title,
  value,
  subtitle,
  icon: Icon,
  route,
  tone
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  route?: DashboardRoute;
  tone: TileTone;
}) {
  const content = (
    <>
      <View style={styles.kpiText}>
        <View style={styles.kpiTitleRow}>
          <Icon color={tileColor(tone)} size={18} />
          <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68}>
            {value}
          </Text>
        </View>
        <Text style={styles.kpiTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.kpiSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {route ? <ChevronRight color="#a5a1ad" size={22} /> : null}
    </>
  );

  if (!route) {
    return <View style={[styles.kpiTile, styles[`${tone}Tile`]]}>{content}</View>;
  }

  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(route)} style={({ pressed }) => [styles.kpiTile, styles[`${tone}Tile`], pressed ? styles.pressed : null]}>
      {content}
    </Pressable>
  );
}

function TransactionRow({ invoice }: { invoice: InvoiceSummary }) {
  const due = Number(invoice.balanceDue || 0) > 0;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: invoice.id } })}
      style={({ pressed }) => [styles.transactionRow, pressed ? styles.pressed : null]}
    >
      <View style={[styles.transactionIcon, due ? styles.transactionIconDue : null]}>
        <ReceiptText color={due ? colors.warning : colors.primary} size={20} />
      </View>
      <View style={styles.transactionText}>
        <Text style={styles.transactionTitle} numberOfLines={1}>
          {invoice.invoiceNumber || invoice.customerName || "Invoice"}
        </Text>
        <Text style={styles.transactionSub} numberOfLines={1}>
          {[invoice.customerName, invoice.vehicleNumber, formatDate(invoice.invoiceDate)].filter(Boolean).join(" | ")}
        </Text>
      </View>
      <View style={styles.transactionAmount}>
        <Text style={styles.transactionTotal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(invoice.grandTotal)}
        </Text>
        <Text style={[styles.transactionStatus, due ? styles.dueText : styles.paidText]} numberOfLines={1}>
          {due ? "Due" : "Paid"}
        </Text>
      </View>
    </Pressable>
  );
}

function QuickSheetItem({
  icon: Icon,
  label,
  route,
  onPress,
  tone = "default"
}: {
  icon: LucideIcon;
  label: string;
  route?: DashboardRoute;
  onPress?: () => void;
  tone?: "default" | "danger";
}) {
  function handlePress() {
    if (onPress) {
      onPress();
      return;
    }
    if (route) router.push(route);
  }

  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={({ pressed }) => [styles.quickSheetItem, tone === "danger" ? styles.quickSheetDanger : null, pressed ? styles.pressed : null]}>
      <Icon color={tone === "danger" ? colors.danger : colors.primary} size={18} />
      <Text style={[styles.quickSheetText, tone === "danger" ? styles.quickSheetDangerText : null]}>{label}</Text>
    </Pressable>
  );
}

function tileColor(tone: TileTone) {
  if (tone === "green") return colors.success;
  if (tone === "red") return colors.danger;
  if (tone === "blue") return colors.info;
  if (tone === "gold") return colors.warning;
  if (tone === "purple") return colors.primary;
  return colors.primaryDark;
}

const styles = StyleSheet.create({
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  brandButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  brandText: {
    minWidth: 0,
    gap: 2
  },
  brandName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900"
  },
  brandSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.purpleSoft
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800"
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12
  },
  kpiTile: {
    width: "48%",
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 12,
    paddingVertical: 11,
    shadowColor: "#2f285f",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 9,
    elevation: 2
  },
  kpiText: {
    flex: 1,
    minWidth: 0,
    gap: 4
  },
  kpiTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  kpiValue: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  kpiTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  kpiSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  greenTile: {
    borderColor: "#bfe6ce",
    backgroundColor: colors.greenSoft
  },
  redTile: {
    borderColor: "#f0bcbc",
    backgroundColor: colors.redSoft
  },
  blueTile: {
    borderColor: "#c7dcf3",
    backgroundColor: colors.blueSoft
  },
  purpleTile: {
    borderColor: "#d6cdf8",
    backgroundColor: colors.purpleSoft
  },
  goldTile: {
    borderColor: "#efd49a",
    backgroundColor: colors.goldSoft
  },
  plainTile: {},
  actionSummary: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#d6cdf8",
    backgroundColor: colors.purpleSoft,
    padding: 12
  },
  actionSummaryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  actionSummaryTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  actionSummaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  actionSummarySub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  actionSummaryBadge: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 10
  },
  actionSummaryBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  actionMiniList: {
    gap: 7
  },
  actionMiniRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  actionDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill
  },
  actionDotCritical: {
    backgroundColor: colors.danger
  },
  actionDotWarning: {
    backgroundColor: colors.warning
  },
  actionDotInfo: {
    backgroundColor: colors.info
  },
  actionMiniText: {
    flex: 1,
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900"
  },
  actionClearText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700"
  },
  deviceRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.divider,
    paddingVertical: 12
  },
  deviceIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.goldSoft
  },
  deviceText: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  deviceTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  deviceSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  transactionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "900"
  },
  sectionSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  rangeButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    backgroundColor: colors.purpleSoft
  },
  rangeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  transactionPanel: {
    minHeight: 240,
    gap: 10
  },
  transactionRow: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 11
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.purpleSoft
  },
  transactionIconDue: {
    backgroundColor: colors.goldSoft
  },
  transactionText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  transactionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  transactionSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  transactionAmount: {
    width: "32%",
    minWidth: 0,
    alignItems: "flex-end",
    gap: 2
  },
  transactionTotal: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    maxWidth: "100%"
  },
  transactionStatus: {
    fontSize: 11,
    fontWeight: "900"
  },
  dueText: {
    color: colors.warning
  },
  paidText: {
    color: colors.success
  },
  emptyState: {
    minHeight: 250,
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  emptyTitle: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "900"
  },
  emptySub: {
    maxWidth: 280,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    fontWeight: "700"
  },
  quickSheet: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 10
  },
  quickSheetItem: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 12
  },
  quickSheetText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900"
  },
  quickSheetDanger: {
    borderColor: "#f0bcbc",
    backgroundColor: colors.redSoft
  },
  quickSheetDangerText: {
    color: colors.danger
  },
  quickFooter: {
    gap: 8
  },
  quickBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 6,
    shadowColor: "#302d45",
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5
  },
  quickButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    paddingHorizontal: 10
  },
  quickButtonDark: {
    backgroundColor: colors.primaryDark
  },
  quickButtonPrimary: {
    backgroundColor: colors.primary
  },
  quickButtonDarkText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900"
  },
  quickButtonPrimaryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900"
  },
  plusButton: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6fc587",
    shadowColor: "#2f9d58",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
