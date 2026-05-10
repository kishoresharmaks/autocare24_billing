import { StyleSheet, Text } from "react-native";
import { colors, radius } from "../theme";
import type { CloudDeviceApprovalStatus } from "../types/cloud";

export function StatusPill({ status }: { status: CloudDeviceApprovalStatus | "" }) {
  const tone = status === "APPROVED" ? "approved" : status === "REVOKED" ? "revoked" : "pending";
  return (
    <Text style={[styles.pill, styles[tone]]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
      {status || "NOT CONNECTED"}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    flexShrink: 1,
    maxWidth: "100%",
    borderRadius: radius.pill,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: "800"
  },
  approved: {
    backgroundColor: colors.greenSoft,
    color: colors.success
  },
  pending: {
    backgroundColor: colors.goldSoft,
    color: colors.warning
  },
  revoked: {
    backgroundColor: colors.redSoft,
    color: colors.danger
  }
});
