import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PropsWithChildren } from "react";

onlineManager.setEventListener((setOnline: (online: boolean) => void) => {
  return NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
    setOnline(Boolean(state.isConnected));
  });
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24,
      networkMode: "offlineFirst",
      retry: 1,
      staleTime: 1000 * 60 * 2
    }
  }
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "AUTOCARE24_REPORTS_QUERY_CACHE"
});

export function AppQueryProvider({ children }: PropsWithChildren) {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      {children}
    </PersistQueryClientProvider>
  );
}
