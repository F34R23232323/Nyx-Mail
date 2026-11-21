import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import { usePalette } from "../../theme/ThemeProvider";
import { AppText } from "./AppText";

export function LogoMark({ size = 40, radiusSize }: { size?: number; radiusSize?: number }) {
  const palette = usePalette();
  return (
    <LinearGradient
      colors={[palette.gradient[0], palette.gradient[1], palette.gradient[2]]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: radiusSize ?? size * 0.3,
        },
      ]}
    >
      <Svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" fill="none">
        <Path
          d="M2.6 6.4 12 12.8l9.4-6.4"
          stroke="#FFFFFF"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M2.5 7.1v9.4c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V7.1c0-1.4-1.6-2.2-2.7-1.4L12 10.5 5.2 5.7C4.1 4.9 2.5 5.7 2.5 7.1Z"
          fill="#FFFFFF"
          fillOpacity="0.96"
        />
      </Svg>
      <View style={styles.shine} pointerEvents="none" />
    </LinearGradient>
  );
}

export function Logo({ size = 40, showWordmark = true }: { size?: number; showWordmark?: boolean }) {
  const palette = usePalette();
  return (
    <View style={styles.row}>
      <LogoMark size={size} />
      {showWordmark ? (
        <AppText variant="heading" weight="semibold" style={{ letterSpacing: -0.5 }}>
          Nyx
          <AppText variant="heading" weight="semibold" color={palette.accentStrong} style={{ letterSpacing: -0.5 }}>
            Mail
          </AppText>
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#5E45E8",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 11 },
  shine: {
    position: "absolute",
    top: -20,
    left: -10,
    right: -10,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.18)",
    transform: [{ rotate: "-12deg" }],
  },
});
