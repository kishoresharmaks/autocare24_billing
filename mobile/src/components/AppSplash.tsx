import { useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DeveloperCredit } from "./DeveloperCredit";
import { MOBILE_APP_NAME, MOBILE_APP_SUBTITLE } from "../constants/appInfo";
import { colors, radius } from "../theme";

export function AppSplash() {
  const pulse = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        })
      ])
    );
    const orbitLoop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 1350,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );

    pulseLoop.start();
    orbitLoop.start();
    return () => {
      pulseLoop.stop();
      orbitLoop.stop();
    };
  }, [orbit, pulse]);

  const logoScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.035]
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34, 0.78]
  });
  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1.08]
  });
  const rotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"]
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.content}>
        <View style={styles.brandBlock}>
          <Animated.View style={[styles.logoGlow, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
          <Animated.View style={[styles.spinnerArc, { transform: [{ rotate }] }]} />
          <Animated.View style={[styles.logoDisc, { transform: [{ scale: logoScale }] }]}>
            <View style={styles.logoClip}>
              <Image source={require("../../assets/autocare24-icon.png")} resizeMode="cover" style={styles.logo} />
            </View>
          </Animated.View>
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.eyebrow}>{MOBILE_APP_SUBTITLE}</Text>
          <Text style={styles.title}>{MOBILE_APP_NAME}</Text>
          <Text style={styles.subtitle}>Loading your secure owner workspace</Text>
        </View>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { opacity: ringOpacity }]} />
        </View>
      </View>
      <DeveloperCredit compact />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    paddingVertical: 28
  },
  content: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 24
  },
  brandBlock: {
    width: 196,
    height: 196,
    alignItems: "center",
    justifyContent: "center"
  },
  logoGlow: {
    position: "absolute",
    width: 184,
    height: 184,
    borderRadius: 92,
    backgroundColor: colors.purpleSoft
  },
  spinnerArc: {
    position: "absolute",
    width: 172,
    height: 172,
    borderRadius: 86,
    borderWidth: 5,
    borderColor: colors.border,
    borderTopColor: colors.primary,
    borderRightColor: colors.accent
  },
  logoDisc: {
    width: 132,
    height: 132,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 66,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    shadowColor: "#2f285f",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4
  },
  logoClip: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 58,
    backgroundColor: colors.surfaceStrong
  },
  logo: {
    width: "100%",
    height: "100%"
  },
  textBlock: {
    width: "100%",
    alignItems: "center",
    gap: 6
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: "900",
    textAlign: "center"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  progressTrack: {
    width: "72%",
    maxWidth: 260,
    height: 6,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: colors.purpleSoft
  },
  progressFill: {
    width: "62%",
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.primary
  }
});
