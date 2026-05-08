import { Stack } from "expo-router";

export default function AppStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="profit" />
      <Stack.Screen name="stock" />
      <Stack.Screen name="invoices" />
      <Stack.Screen name="devices" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}
