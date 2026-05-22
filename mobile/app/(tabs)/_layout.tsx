import { Tabs } from "expo-router";
import { BarChart3, FileText, Home, MoreHorizontal, Package } from "lucide-react-native";
import { colors } from "../../src/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { hasPermission } from "../../src/services/permissions";

export default function AppStackLayout() {
  const session = useSession();
  const canDashboard = hasPermission(session.user, "dashboard.view");
  const canBilling = hasPermission(session.user, "billing.view");
  const canStock = hasPermission(session.user, "stock.view");
  const canReports = hasPermission(session.user, "reports.view");
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          height: 66,
          borderTopColor: colors.divider,
          backgroundColor: colors.surfaceStrong,
          paddingBottom: 8,
          paddingTop: 6
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "800"
        }
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", href: canDashboard ? undefined : null, tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="invoices" options={{ title: "Invoices", href: canBilling ? undefined : null, tabBarIcon: ({ color, size }) => <FileText color={color} size={size} /> }} />
      <Tabs.Screen name="stock" options={{ title: "Stock", href: canStock ? undefined : null, tabBarIcon: ({ color, size }) => <Package color={color} size={size} /> }} />
      <Tabs.Screen name="reports" options={{ title: "Reports", href: canReports ? undefined : null, tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }} />
      <Tabs.Screen name="action-center" options={{ href: null }} />
      <Tabs.Screen name="profit" options={{ href: null }} />
      <Tabs.Screen name="devices" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
