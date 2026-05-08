import { useWindowDimensions } from "react-native";

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isNarrow = width < 380;
  const isCompact = width < 560;
  const isTablet = width >= 720;

  return {
    width,
    height,
    isNarrow,
    isCompact,
    isTablet,
    horizontalPadding: isNarrow ? 12 : isTablet ? 24 : 16,
    verticalPadding: isNarrow ? 14 : 18,
    contentMaxWidth: isTablet ? 860 : undefined,
    authMaxWidth: isTablet ? 560 : undefined,
    metricColumns: isTablet ? 3 : isNarrow ? 1 : 2,
    sectionGap: isNarrow ? 12 : 16
  };
}
