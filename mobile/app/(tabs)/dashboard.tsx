import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileText,
  HardDrive,
  Package,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  Wallet
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { fetchInventoryDashboard, fetchInvoices, fetchProfit, fetchReport } from "../../src/services/cloudApi";
import {
  dashboardKpiLimits,
  defaultDashboardKpis,
  loadDashboardKpis,
  saveDashboardKpis,
  type DashboardKpiId
} from "../../src/services/dashboardPreferences";
import { Screen } from "../../src/components/Screen";
import { SalesTrendChart } from "../../src/components/SalesTrendChart";
import { StatusPill } from "../../src/components/StatusPill";
import { colors } from "../../src/theme";
import type { DateRangePreset, InvoiceSummary, InventoryDashboardData, ProfitReportData, ReportData } from "../../src/types/cloud";
import { formatCount, formatDate, formatMoney } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { useSession } from "../../src/providers/SessionProvider";

const dashboardPreset: DateRangePreset = "30d";

type KpiTone = "default" | "success" | "warning" | "danger" | "info";
type KpiDefinition = {
  id: DashboardKpiId;
  label: string;
  value: string;
  hint: string;
  tone: KpiTone;
  icon: LucideIcon;
};

export default function DashboardTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const layout = useResponsiveLayout();
  const [selectedKpis, setSelectedKpis] = useState<DashboardKpiId[]>(defaultDashboardKpis);
  const [customizing, setCustomizing] = useState(false);
  const [preferenceNote, setPreferenceNote] = useState("");

  useEffect(() => {
    let active = true;
    loadDashboardKpis()
      .then((ids) => {
        if (active) setSelectedKpis(ids);
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

  const report = reportQuery.data;
  const profit = profitQuery.data;
  const inventory = inventoryQuery.data;
  const invoices = invoicesQuery.data || [];
  const isRefreshing = reportQuery.isFetching || profitQuery.isFetching || inventoryQuery.isFetching || invoicesQuery.isFetching;

  const kpis = useMemo(() => buildKpis(report, profit, inventory), [report, profit, inventory]);
  const visibleKpis = selectedKpis.map((id) => kpis.find((item) => item.id === id)).filter(Boolean) as KpiDefinition[];
  const alerts = buildAlerts(report, profit, inventory, session.isOnline);

  if (guard) return guard;

  async function refreshAll() {
    await Promise.all([reportQuery.refetch(), profitQuery.refetch(), inventoryQuery.refetch(), invoicesQuery.refetch()]);
  }

  async function toggleKpi(id: DashboardKpiId) {
    setPreferenceNote("");
    const selected = selectedKpis.includes(id);
    if (selected && selectedKpis.length <= dashboardKpiLimits.min) {
      setPreferenceNote(`Select at least ${dashboardKpiLimits.min} KPI cards.`);
      return;
    }
    if (!selected && selectedKpis.length >= dashboardKpiLimits.max) {
      setPreferenceNote(`Select no more than ${dashboardKpiLimits.max} KPI cards.`);
      return;
    }
    const next = selected ? selectedKpis.filter((item) => item !== id) : [...selectedKpis, id];
    setSelectedKpis(next);
    await saveDashboardKpis(next);
  }

  const firstError = [reportQuery.error, profitQuery.error, inventoryQuery.error, invoicesQuery.error].find(Boolean);

  return (
    <Screen title="Dashboard" subtitle="Owner command center" refreshing={isRefreshing} onRefresh={refreshAll}>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitle}>
            <Text style={styles.eyebrow}>Autocare24</Text>
            <Text style={styles.heroHeading} numberOfLines={2}>
              Welcome, {session.user?.displayName || session.user?.username || "Owner"}
            </Text>
            <Text style={styles.heroSub} numberOfLines={2}>
              {report?.rangeLabel || "30 day"} business pulse with live cloud values.
            </Text>
          </View>
          <StatusPill status={session.approvalStatus} />
        </View>
        <View style={styles.heroStats}>
          <HeroStat label="Network" value={session.isOnline ? "Online" : "Offline"} tone={session.isOnline ? "success" : "danger"} />
          <HeroStat label="Phone" value={session.device?.deviceCode || session.deviceCode || "Ready"} />
          <HeroStat label="Cached" value={isRefreshing ? "Syncing" : "Ready"} tone={firstError ? "warning" : "success"} />
        </View>
      </View>

      {firstError ? (
        <Text style={styles.error}>{firstError instanceof Error ? firstError.message : "Some dashboard values could not be refreshed."}</Text>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.sectionTitle}>Live KPI values</Text>
            <Text style={styles.sectionSub}>{visibleKpis.length} selected cards</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setCustomizing((value) => !value)}
            style={({ pressed }) => [styles.smallButton, pressed ? styles.pressed : null]}
          >
            <SlidersHorizontal color={colors.primaryDark} size={17} />
            <Text style={styles.smallButtonText}>{customizing ? "Done" : "Customize"}</Text>
          </Pressable>
        </View>
        {customizing ? (
          <View style={styles.customizer}>
            {kpis.map((item) => (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedKpis.includes(item.id) }}
                key={item.id}
                onPress={() => void toggleKpi(item.id)}
                style={({ pressed }) => [
                  styles.kpiChoice,
                  selectedKpis.includes(item.id) ? styles.kpiChoiceActive : null,
                  pressed ? styles.pressed : null
                ]}
              >
                <Text style={[styles.kpiChoiceText, selectedKpis.includes(item.id) ? styles.kpiChoiceTextActive : null]}>{item.label}</Text>
              </Pressable>
            ))}
            <Text style={styles.customizerNote}>
              Choose {dashboardKpiLimits.min}-{dashboardKpiLimits.max} live KPI cards for this phone.
            </Text>
            {preferenceNote ? <Text style={styles.warningText}>{preferenceNote}</Text> : null}
          </View>
        ) : null}
        <View style={styles.kpiGrid}>
          {visibleKpis.map((item) => (
            <DashboardKpi key={item.id} item={item} />
          ))}
        </View>
      </View>

      <View style={styles.navGrid}>
        <NavTile icon={BarChart3} label="Reports" value={formatMoney(report?.paidAmount)} hint="Sales, GST and dues" route="/reports" tone="blue" />
        <NavTile icon={CircleDollarSign} label="Profit" value={formatMoney(profit?.cashProfit)} hint="Revenue minus costs" route="/profit" tone="green" />
        <NavTile icon={Package} label="Stock" value={formatMoney(inventory?.totalStockValue)} hint={`${formatCount(inventory?.lowStockCount)} low stock`} route="/stock" tone="gold" />
        <NavTile icon={ReceiptText} label="Invoices" value={formatCount(invoices.length)} hint="Search cloud invoices" route="/invoices" tone="red" />
        <NavTile icon={HardDrive} label="Devices" value={session.approvalStatus || "PENDING"} hint="Approve phones" route="/devices" tone="purple" />
        <NavTile icon={Settings} label="Settings" value={session.isOnline ? "Online" : "Offline"} hint="Session and cloud" route="/settings" tone="plain" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Priority alerts</Text>
        {alerts.map((alert) => (
          <AlertRow key={alert.label} label={alert.label} detail={alert.detail} tone={alert.tone} />
        ))}
        {!alerts.length ? <AlertRow label="No urgent action" detail="Sales, dues, stock, and cloud status look clear." tone="success" /> : null}
      </View>

      <View style={[styles.split, layout.isTablet ? styles.splitWide : null]}>
        <View style={[styles.section, layout.isTablet ? styles.splitItem : null]}>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.sectionTitle}>Daily Sales Trend</Text>
            <Text style={styles.sectionSub}>Billed invoices vs paid collections</Text>
          </View>
          <SalesTrendChart points={report?.salesTrend || []} compact />
        </View>
        <View style={[styles.section, layout.isTablet ? styles.splitItem : null]}>
          <Text style={styles.sectionTitle}>Top services</Text>
          {(report?.topServices || []).slice(0, 5).map((service) => (
            <ListRow key={service.name} title={service.name} subtitle={`${service.quantity} services`} value={formatMoney(service.revenue)} />
          ))}
          {!report?.topServices?.length ? <Text style={styles.empty}>No billed services in this range.</Text> : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pending dues</Text>
        {(report?.dues || []).slice(0, 5).map((invoice) => (
          <ListRow key={invoice.id} title={invoice.invoiceNumber || invoice.customerName} subtitle={invoice.customerName || invoice.vehicleNumber || invoice.invoiceDate} value={formatMoney(invoice.balanceDue)} />
        ))}
        {!report?.dues?.length ? <Text style={styles.empty}>No pending dues in this range.</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent invoices</Text>
        {invoices.slice(0, 5).map((invoice: InvoiceSummary) => (
          <Pressable
            accessibilityRole="button"
            key={invoice.id}
            onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: invoice.id } })}
            style={({ pressed }) => [styles.invoiceRow, pressed ? styles.pressed : null]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {invoice.invoiceNumber || "Invoice"}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {invoice.customerName || invoice.vehicleNumber || formatDate(invoice.invoiceDate)}
              </Text>
            </View>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
              {formatMoney(invoice.grandTotal)}
            </Text>
          </Pressable>
        ))}
        {!invoices.length ? <Text style={styles.empty}>No invoices available.</Text> : null}
      </View>
    </Screen>
  );
}

function buildKpis(report?: ReportData, profit?: ProfitReportData, inventory?: InventoryDashboardData): KpiDefinition[] {
  return [
    { id: "paidRevenue", label: "Paid Revenue", value: formatMoney(report?.paidAmount), hint: "Collected in 30 days", tone: "success", icon: Wallet },
    { id: "cashProfit", label: "Cash Profit", value: formatMoney(profit?.cashProfit), hint: "After stock and expenses", tone: (profit?.cashProfit || 0) >= 0 ? "success" : "danger", icon: CircleDollarSign },
    { id: "balanceDue", label: "Balance Due", value: formatMoney(report?.balanceDue), hint: "Payment follow-up", tone: report?.balanceDue ? "warning" : "default", icon: AlertTriangle },
    { id: "invoices", label: "Invoices", value: formatCount(report?.invoiceCount), hint: "Finalized bills", tone: "info", icon: ReceiptText },
    { id: "stockValue", label: "Stock Value", value: formatMoney(inventory?.totalStockValue), hint: "Live inventory", tone: "success", icon: Package },
    { id: "lowStock", label: "Low Stock", value: formatCount(inventory?.lowStockCount), hint: "Needs refill check", tone: inventory?.lowStockCount ? "warning" : "default", icon: Package },
    { id: "expiringBatches", label: "Expiring", value: formatCount(inventory?.expiringCount), hint: "Batches under watch", tone: inventory?.expiringCount ? "warning" : "default", icon: AlertTriangle },
    { id: "profitMargin", label: "Margin", value: `${Number(profit?.profitMargin || 0).toFixed(2)}%`, hint: "Cash profit ratio", tone: (profit?.profitMargin || 0) >= 0 ? "info" : "danger", icon: BarChart3 },
    { id: "expenses", label: "Expenses", value: formatMoney(profit?.expenseTotal), hint: "30 day spend", tone: profit?.expenseTotal ? "warning" : "default", icon: FileText }
  ];
}

function buildAlerts(report?: ReportData, profit?: ProfitReportData, inventory?: InventoryDashboardData, isOnline = true) {
  const alerts: Array<{ label: string; detail: string; tone: "success" | "warning" | "danger" }> = [];
  if (!isOnline) alerts.push({ label: "Phone is offline", detail: "Showing cached dashboard values until cloud is reachable.", tone: "danger" });
  if ((report?.balanceDue || 0) > 0) alerts.push({ label: "Pending dues", detail: `${formatMoney(report?.balanceDue)} needs payment follow-up.`, tone: "warning" });
  if ((inventory?.lowStockCount || 0) > 0) alerts.push({ label: "Low stock", detail: `${formatCount(inventory?.lowStockCount)} item(s) are at or below alert level.`, tone: "warning" });
  if ((inventory?.expiringCount || 0) > 0) alerts.push({ label: "Expiring stock", detail: `${formatCount(inventory?.expiringCount)} batch(es) expire soon.`, tone: "warning" });
  if ((profit?.cashProfit || 0) < 0) alerts.push({ label: "Profit loss", detail: "Cash profit is negative for the selected period.", tone: "danger" });
  return alerts.slice(0, 5);
}

function DashboardKpi({ item }: { item: KpiDefinition }) {
  const Icon = item.icon;
  return (
    <View style={[styles.kpiCard, styles[`${item.tone}Card`]]}>
      <View style={styles.kpiTop}>
        <View style={[styles.kpiIcon, styles[`${item.tone}Icon`]]}>
          <Icon color={kpiIconColor(item.tone)} size={20} />
        </View>
        <Text style={styles.kpiLabel} numberOfLines={1}>
          {item.label}
        </Text>
      </View>
      <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68}>
        {item.value}
      </Text>
      <Text style={styles.kpiHint} numberOfLines={2}>
        {item.hint}
      </Text>
    </View>
  );
}

function NavTile({
  icon: Icon,
  label,
  value,
  hint,
  route,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  route: "/reports" | "/profit" | "/stock" | "/invoices" | "/devices" | "/settings";
  tone: "green" | "gold" | "blue" | "red" | "purple" | "plain";
}) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(route)} style={({ pressed }) => [styles.navTile, pressed ? styles.pressed : null]}>
      <View style={[styles.navIcon, styles[`${tone}NavIcon`]]}>
        <Icon color={navIconColor(tone)} size={23} />
      </View>
      <View style={styles.navText}>
        <Text style={styles.navLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.navValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value}
        </Text>
        <Text style={styles.navHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

function HeroStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" | "warning" }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={[styles.heroStatValue, tone === "success" ? styles.successText : tone === "danger" ? styles.dangerText : tone === "warning" ? styles.warningText : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function AlertRow({ label, detail, tone }: { label: string; detail: string; tone: "success" | "warning" | "danger" }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <View style={[styles.alertRow, tone === "success" ? styles.alertSuccess : tone === "danger" ? styles.alertDanger : styles.alertWarning]}>
      <Icon color={tone === "success" ? colors.success : tone === "danger" ? colors.danger : colors.warning} size={20} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{label}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{detail}</Text>
      </View>
    </View>
  );
}

function ListRow({ title, subtitle, value }: { title: string; subtitle: string; value: string }) {
  return (
    <View style={styles.listRow}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>{title || "Not available"}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{subtitle || "Not available"}</Text>
      </View>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

function kpiIconColor(tone: KpiTone) {
  if (tone === "success") return colors.success;
  if (tone === "warning") return colors.warning;
  if (tone === "danger") return colors.danger;
  if (tone === "info") return colors.info;
  return colors.primaryDark;
}

function navIconColor(tone: "green" | "gold" | "blue" | "red" | "purple" | "plain") {
  if (tone === "gold") return colors.warning;
  if (tone === "blue") return colors.info;
  if (tone === "red") return colors.accent;
  if (tone === "purple") return "#6545a3";
  if (tone === "plain") return colors.text;
  return colors.primaryDark;
}

const styles = StyleSheet.create({
  hero: {
    gap: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c9dddb",
    backgroundColor: colors.surfaceStrong,
    padding: 16
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  heroTitle: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  heroHeading: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 30
  },
  heroSub: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  heroStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  heroStat: {
    flex: 1,
    minWidth: 98,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 10,
    gap: 3
  },
  heroStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  heroStatValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900"
  },
  section: {
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  sectionTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  sectionSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  smallButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 10
  },
  smallButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900"
  },
  customizer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 10
  },
  kpiChoice: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    justifyContent: "center"
  },
  kpiChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: "#dff2eb"
  },
  kpiChoiceText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  kpiChoiceTextActive: {
    color: colors.primaryDark
  },
  customizerNote: {
    width: "100%",
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between"
  },
  kpiCard: {
    width: "48%",
    minHeight: 128,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 9
  },
  kpiTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  kpiIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  kpiLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  kpiValue: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900"
  },
  kpiHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  successCard: {
    borderColor: "#b5dac8"
  },
  warningCard: {
    borderColor: "#dfbd82"
  },
  dangerCard: {
    borderColor: "#dc9d9d"
  },
  infoCard: {
    borderColor: "#9ebde0"
  },
  defaultCard: {},
  successIcon: {
    backgroundColor: "#d9efe5"
  },
  warningIcon: {
    backgroundColor: "#f6ead1"
  },
  dangerIcon: {
    backgroundColor: "#f4dddd"
  },
  infoIcon: {
    backgroundColor: "#e3eefb"
  },
  defaultIcon: {},
  navGrid: {
    gap: 10
  },
  navTile: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  navIcon: {
    width: 46,
    height: 46,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  greenNavIcon: {
    backgroundColor: "#d9efe5"
  },
  goldNavIcon: {
    backgroundColor: "#f6ead1"
  },
  blueNavIcon: {
    backgroundColor: "#e3eefb"
  },
  redNavIcon: {
    backgroundColor: "#f7e2da"
  },
  purpleNavIcon: {
    backgroundColor: "#ece5fb"
  },
  plainNavIcon: {
    backgroundColor: colors.surface
  },
  navText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  navLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  navValue: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900"
  },
  navHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  alertRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    padding: 10
  },
  alertSuccess: {
    backgroundColor: "#edf8f1"
  },
  alertWarning: {
    backgroundColor: "#fff6e4"
  },
  alertDanger: {
    backgroundColor: "#fbe8e8"
  },
  split: {
    gap: 12
  },
  splitWide: {
    flexDirection: "row"
  },
  splitItem: {
    flex: 1
  },
  listRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee2d5",
    paddingTop: 10
  },
  invoiceRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee2d5",
    paddingTop: 10
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  rowSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  amount: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    maxWidth: "42%",
    textAlign: "right"
  },
  successText: {
    color: colors.success
  },
  warningText: {
    color: colors.warning
  },
  dangerText: {
    color: colors.danger
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800"
  }
});
