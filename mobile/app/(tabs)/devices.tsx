import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { CloudApiError, approveDevice, fetchDevices, isVisibleCloudDevice, revokeDevice, summarizeDeviceStatus } from "../../src/services/cloudApi";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { Screen } from "../../src/components/Screen";
import { StatusPill } from "../../src/components/StatusPill";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { colors } from "../../src/theme";
import { formatCount, formatDateTime } from "../../src/utils/format";
import { useRequirePermission } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import type { CloudDeviceSummary } from "../../src/types/cloud";

export default function DevicesTab() {
  const guard = useRequirePermission("users.manage");
  const session = useSession();
  const queryClient = useQueryClient();
  const devicesQueryKey = ["devices", session.cloudUrl, session.token, session.userToken];
  const devicesQuery = useQuery({
    queryKey: devicesQueryKey,
    queryFn: () => fetchDevices(session.cloudUrl, session.token, session.userToken),
    enabled: Boolean(session.user && session.token && session.userToken)
  });
  const approveMutation = useMutation({
    mutationFn: (deviceId: string) => approveDevice(session.cloudUrl, session.token, deviceId, session.userToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: devicesQueryKey })
  });
  const revokeMutation = useMutation({
    mutationFn: (deviceId: string) => revokeDevice(session.cloudUrl, session.token, deviceId, session.userToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: devicesQueryKey })
  });

  useEffect(() => {
    if (devicesQuery.error instanceof CloudApiError && devicesQuery.error.code === "user_session_invalid") {
      void session.logoutUser().then(() => router.replace("/login"));
    }
  }, [devicesQuery.error, session]);

  if (guard) return guard;

  const visibleDevices = (devicesQuery.data?.devices || []).filter(isVisibleCloudDevice);
  const summary = summarizeDeviceStatus(visibleDevices);

  return (
    <Screen title="Cloud Devices" subtitle="Approve or revoke phones with Users and devices permission." refreshing={devicesQuery.isFetching} onRefresh={devicesQuery.refetch} showHome>
      {devicesQuery.error ? <Text style={styles.error}>{devicesQuery.error instanceof Error ? devicesQuery.error.message : "Unable to load devices."}</Text> : null}
      {approveMutation.error ? <Text style={styles.error}>{approveMutation.error instanceof Error ? approveMutation.error.message : "Unable to approve device."}</Text> : null}
      {revokeMutation.error ? <Text style={styles.error}>{revokeMutation.error instanceof Error ? revokeMutation.error.message : "Unable to revoke device."}</Text> : null}
      <MetricGrid>
        <MetricCard label="Total" value={formatCount(summary.total)} />
        <MetricCard label="Approved" value={formatCount(summary.approved)} tone="success" />
        <MetricCard label="Pending" value={formatCount(summary.pending)} tone="warning" />
      </MetricGrid>
      <FlatList<CloudDeviceSummary>
        data={visibleDevices}
        keyExtractor={(item: CloudDeviceSummary) => item.id}
        onRefresh={devicesQuery.refetch}
        refreshing={devicesQuery.isFetching}
        scrollEnabled={false}
        renderItem={({ item }: { item: CloudDeviceSummary }) => (
          <DeviceRow
            device={item}
            currentDeviceId={devicesQuery.data?.currentDeviceId || session.deviceId}
            isApproving={approveMutation.isPending && approveMutation.variables === item.id}
            isRevoking={revokeMutation.isPending && revokeMutation.variables === item.id}
            onApprove={() => approveMutation.mutate(item.id)}
            onRevoke={() => {
              Alert.alert(
                "Revoke device access",
                `Revoke ${item.name || item.deviceCode || "this device"}? It will not be able to access cloud data until approved again.`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Revoke", style: "destructive", onPress: () => revokeMutation.mutate(item.id) }
                ]
              );
            }}
          />
        )}
        ListEmptyComponent={!devicesQuery.isLoading ? <Text style={styles.empty}>No pending or approved cloud devices found.</Text> : null}
        contentContainerStyle={styles.list}
      />
    </Screen>
  );
}

function DeviceRow({
  device,
  currentDeviceId,
  isApproving,
  isRevoking,
  onApprove,
  onRevoke
}: {
  device: CloudDeviceSummary;
  currentDeviceId: string;
  isApproving: boolean;
  isRevoking: boolean;
  onApprove: () => void;
  onRevoke: () => void;
}) {
  const layout = useResponsiveLayout();
  const current = device.id === currentDeviceId;
  const canApprove = !current && device.approvalStatus === "PENDING";
  const canRevoke = !current && device.approvalStatus === "APPROVED" && !device.isRevoked;
  return (
    <View style={styles.deviceCard}>
      <View style={styles.deviceHeader}>
        <View style={styles.deviceTitleWrap}>
          <Text style={styles.deviceName}>{device.name || "Unnamed device"}</Text>
          <Text style={styles.deviceCode}>{device.deviceCode || device.id}</Text>
        </View>
        <StatusPill status={device.approvalStatus} />
      </View>
      {current ? <Text style={styles.current}>This phone</Text> : null}
      <View style={styles.detailGrid}>
        <Detail label="Requested" value={formatDateTime(device.approvalRequestedAt)} wide={layout.isTablet} />
        <Detail label="Approved" value={formatDateTime(device.approvedAt)} wide={layout.isTablet} />
        <Detail label="Last seen" value={formatDateTime(device.lastSeenAt)} wide={layout.isTablet} />
        <Detail label="IP address" value={device.registrationIp || "Not available"} wide={layout.isTablet} />
      </View>
      {canApprove || canRevoke || current ? (
        <View style={styles.actions}>
          {canApprove ? <ActionButton label={isApproving ? "Approving..." : "Approve"} onPress={onApprove} disabled={isApproving || isRevoking} tone="approve" /> : null}
          {canRevoke ? <ActionButton label={isRevoking ? "Revoking..." : "Revoke"} onPress={onRevoke} disabled={isApproving || isRevoking} tone="revoke" /> : null}
          {current ? <Text style={styles.currentNote}>Current phone cannot revoke itself.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({ label, onPress, disabled, tone }: { label: string; onPress: () => void; disabled: boolean; tone: "approve" | "revoke" }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        tone === "approve" ? styles.approveButton : styles.revokeButton,
        pressed && !disabled ? styles.actionPressed : null,
        disabled ? styles.actionDisabled : null
      ]}
    >
      <Text style={[styles.actionText, tone === "approve" ? styles.approveText : styles.revokeText]}>{label}</Text>
    </Pressable>
  );
}

function Detail({ label, value, wide }: { label: string; value: string; wide: boolean }) {
  return (
    <View style={[styles.detail, wide ? styles.detailWide : null]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12
  },
  deviceCard: {
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  deviceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  deviceTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 4
  },
  deviceName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    flexShrink: 1
  },
  deviceCode: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  current: {
    color: colors.info,
    fontSize: 12,
    fontWeight: "900"
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  detail: {
    width: "100%",
    gap: 2
  },
  detailWide: {
    width: "48%"
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  detailValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700"
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10
  },
  actionButton: {
    flexGrow: 1,
    minWidth: 108,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  approveButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  revokeButton: {
    backgroundColor: "#ffffff",
    borderColor: colors.danger
  },
  actionText: {
    fontSize: 13,
    fontWeight: "900"
  },
  approveText: {
    color: "#ffffff"
  },
  revokeText: {
    color: colors.danger
  },
  actionPressed: {
    transform: [{ scale: 0.99 }]
  },
  actionDisabled: {
    opacity: 0.6
  },
  currentNote: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700"
  }
});
