import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppQueryProvider } from "../src/providers/QueryProvider";
import { SessionProvider } from "../src/providers/SessionProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppQueryProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="invoice/[id]" />
          </Stack>
        </SessionProvider>
      </AppQueryProvider>
    </SafeAreaProvider>
  );
}
