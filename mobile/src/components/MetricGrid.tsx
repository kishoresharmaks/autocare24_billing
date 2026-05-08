import { Children, PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";

export function MetricGrid({ children }: PropsWithChildren) {
  const { metricColumns } = useResponsiveLayout();
  const itemWidth = metricColumns === 1 ? "100%" : metricColumns === 2 ? "48%" : "31.5%";

  return (
    <View style={styles.grid}>
      {Children.map(children, (child) =>
        child ? (
          <View style={[styles.item, { width: itemWidth }]}>{child}</View>
        ) : null
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between"
  },
  item: {
    minWidth: 0
  }
});
