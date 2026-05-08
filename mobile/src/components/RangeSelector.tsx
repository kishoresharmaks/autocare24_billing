import { Pressable, StyleSheet, Text, View } from "react-native";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { colors } from "../theme";
import type { DateRangePreset } from "../types/cloud";

export type RangeSelectorValue = DateRangePreset | "custom";

const options: Array<{ label: string; value: DateRangePreset }> = [
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "All", value: "all" }
];

const customOption = { label: "Custom", value: "custom" as const };

export function RangeSelector<T extends RangeSelectorValue = DateRangePreset>({
  value,
  onChange,
  includeCustom = false
}: {
  value: T;
  onChange: (value: T) => void;
  includeCustom?: boolean;
}) {
  const layout = useResponsiveLayout();
  const visibleOptions = includeCustom ? [...options, customOption] : options;

  return (
    <View style={[styles.wrap, layout.isCompact ? styles.wrapCompact : styles.wrapWide, includeCustom && !layout.isCompact ? styles.wrapCustom : null]}>
      {visibleOptions.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={option.value}
            onPress={() => onChange(option.value as T)}
            style={[styles.option, active ? styles.active : null]}
          >
            <Text style={[styles.text, active ? styles.activeText : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    backgroundColor: colors.surfaceStrong
  },
  wrapWide: {
    minWidth: 220
  },
  wrapCustom: {
    minWidth: 292
  },
  wrapCompact: {
    width: "100%"
  },
  option: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  active: {
    backgroundColor: colors.primary
  },
  text: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center"
  },
  activeText: {
    color: "#ffffff"
  }
});
