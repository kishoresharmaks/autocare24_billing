import { Tabs } from "expo-router";
import { BarChart3, FileText, Home, MoreHorizontal, Package } from "lucide-react-native";
import { colors } from "../../src/theme";

export default function AppStackLayout() {
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
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="invoices" options={{ title: "Invoices", tabBarIcon: ({ color, size }) => <FileText color={color} size={size} /> }} />
      <Tabs.Screen name="stock" options={{ title: "Stock", tabBarIcon: ({ color, size }) => <Package color={color} size={size} /> }} />
      <Tabs.Screen name="reports" options={{ title: "Reports", tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }} />
      <Tabs.Screen name="action-center" options={{ href: null }} />
      <Tabs.Screen name="profit" options={{ href: null }} />
      <Tabs.Screen name="devices" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
