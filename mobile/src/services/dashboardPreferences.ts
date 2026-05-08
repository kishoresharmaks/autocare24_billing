import AsyncStorage from "@react-native-async-storage/async-storage";

export type DashboardKpiId =
  | "paidRevenue"
  | "cashProfit"
  | "balanceDue"
  | "invoices"
  | "stockValue"
  | "lowStock"
  | "expiringBatches"
  | "profitMargin"
  | "expenses";

const key = "autocare24.dashboard.kpis";

export const defaultDashboardKpis: DashboardKpiId[] = [
  "paidRevenue",
  "cashProfit",
  "balanceDue",
  "invoices",
  "stockValue",
  "lowStock"
];

export const dashboardKpiLimits = {
  min: 3,
  max: 8
} as const;

export async function loadDashboardKpis(): Promise<DashboardKpiId[]> {
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return defaultDashboardKpis;

  try {
    const parsed = JSON.parse(stored) as DashboardKpiId[];
    return sanitizeDashboardKpis(parsed);
  } catch {
    return defaultDashboardKpis;
  }
}

export async function saveDashboardKpis(ids: DashboardKpiId[]): Promise<DashboardKpiId[]> {
  const sanitized = sanitizeDashboardKpis(ids);
  await AsyncStorage.setItem(key, JSON.stringify(sanitized));
  return sanitized;
}

export function sanitizeDashboardKpis(ids: DashboardKpiId[]): DashboardKpiId[] {
  const allowed = new Set<DashboardKpiId>([
    "paidRevenue",
    "cashProfit",
    "balanceDue",
    "invoices",
    "stockValue",
    "lowStock",
    "expiringBatches",
    "profitMargin",
    "expenses"
  ]);
  const unique = ids.filter((id, index) => allowed.has(id) && ids.indexOf(id) === index);
  if (unique.length < dashboardKpiLimits.min || unique.length > dashboardKpiLimits.max) return defaultDashboardKpis;
  return unique;
}
