import NetInfo from "@react-native-community/netinfo";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { PropsWithChildren } from "react";

onlineManager.setEventListener((setOnline: (online: boolean) => void) => {
  return NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
    setOnline(Boolean(state.isConnected));
  });
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 15,
      networkMode: "offlineFirst",
      retry: 1,
      staleTime: 1000 * 60 * 2
    }
  }
});

export function AppQueryProvider({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
