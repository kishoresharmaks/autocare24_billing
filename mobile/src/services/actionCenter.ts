import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DevicesListResult, InventoryDashboardData, ProfitReportData, ReportData } from "../types/cloud";
import { formatCount, formatMoney } from "../utils/format";

export type ActionItemType = "dues" | "lowStock" | "expiringStock" | "pendingDevices" | "profitWarning" | "cloudIssue";
export type ActionItemSeverity = "critical" | "warning" | "info";
export type ActionItemRoute = "/reports" | "/stock" | "/devices" | "/profit" | "/settings";

export interface ActionItem {
  id: string;
  type: ActionItemType;
  severity: ActionItemSeverity;
  title: string;
  detail: string;
  route: ActionItemRoute;
  amount?: number;
  count?: number;
  createdFrom: string;
  dismissible: boolean;
}

interface BuildActionItemsInput {
  report?: ReportData;
  inventory?: InventoryDashboardData;
  profit?: ProfitReportData;
  devices?: DevicesListResult;
  isOnline: boolean;
  hasCloudError?: boolean;
}

const severityRank: Record<ActionItemSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2
};

export function buildActionItems(input: BuildActionItemsInput): ActionItem[] {
  const items: ActionItem[] = [];
  const balanceDue = Number(input.report?.balanceDue || 0);
  const duesCount = input.report?.dues?.length || 0;
  const lowStockCount = Number(input.inventory?.lowStockCount || 0);
  const expiringCount = Number(input.inventory?.expiringCount || 0);
  const pendingDeviceCount = (input.devices?.devices || []).filter((device) => device.approvalStatus === "PENDING" && !device.isRevoked).length;
  const cashProfit = Number(input.profit?.cashProfit || 0);

  if (!input.isOnline || input.hasCloudError) {
    items.push({
      id: "cloud-issue",
      type: "cloudIssue",
      severity: "critical",
      title: input.isOnline ? "Cloud refresh needs attention" : "Phone is offline",
      detail: input.isOnline ? "Some cloud values could not be refreshed. Check the cloud URL or connection." : "Showing saved data until internet returns.",
      route: "/settings",
      createdFrom: "session",
      dismissible: false
    });
  }

  if (pendingDeviceCount > 0) {
    items.push({
      id: "pending-devices",
      type: "pendingDevices",
      severity: "warning",
      title: "Approve pending devices",
      detail: `${formatCount(pendingDeviceCount)} phone(s) are waiting for approval.`,
      route: "/devices",
      count: pendingDeviceCount,
      createdFrom: "devices",
      dismissible: false
    });
  }

  if (cashProfit < 0) {
    items.push({
      id: "negative-profit",
      type: "profitWarning",
      severity: "critical",
      title: "Profit is negative",
      detail: `${formatMoney(cashProfit)} cash profit for the selected period.`,
      route: "/profit",
      amount: cashProfit,
      createdFrom: "profit",
      dismissible: false
    });
  }

  if (balanceDue > 0 || duesCount > 0) {
    items.push({
      id: "pending-dues",
      type: "dues",
      severity: balanceDue > 0 ? "warning" : "info",
      title: "Collect pending dues",
      detail: `${formatMoney(balanceDue)} pending from ${formatCount(duesCount)} invoice(s).`,
      route: "/reports",
      amount: balanceDue,
      count: duesCount,
      createdFrom: "reports",
      dismissible: true
    });
  }

  if (lowStockCount > 0) {
    items.push({
      id: "low-stock",
      type: "lowStock",
      severity: "warning",
      title: "Low stock items",
      detail: `${formatCount(lowStockCount)} item(s) are at or below alert level.`,
      route: "/stock",
      count: lowStockCount,
      createdFrom: "inventory",
      dismissible: true
    });
  }

  if (expiringCount > 0) {
    items.push({
      id: "expiring-stock",
      type: "expiringStock",
      severity: "warning",
      title: "Expiring stock batches",
      detail: `${formatCount(expiringCount)} batch(es) need expiry review.`,
      route: "/stock",
      count: expiringCount,
      createdFrom: "inventory",
      dismissible: true
    });
  }

  return items.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.title.localeCompare(right.title));
}

export function filterVisibleActionItems(items: ActionItem[], dismissedIds: string[]) {
  const dismissed = new Set(dismissedIds);
  return items.filter((item) => !item.dismissible || !dismissed.has(item.id));
}

export async function loadDismissedActionIds(): Promise<string[]> {
  const stored = await AsyncStorage.getItem(dismissedActionsKey());
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as string[];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function dismissActionForToday(actionId: string): Promise<string[]> {
  const current = await loadDismissedActionIds();
  const next = current.includes(actionId) ? current : [...current, actionId];
  await AsyncStorage.setItem(dismissedActionsKey(), JSON.stringify(next));
  return next;
}

function dismissedActionsKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `autocare24.actionCenter.dismissed.${year}-${month}-${day}`;
}
