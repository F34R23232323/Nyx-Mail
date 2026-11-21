import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radiusSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = "100%", height = 12, radiusSize = radius.sm, style }: SkeletonProps) {
  const palette = usePalette();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.95, duration: 850, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radiusSize,
          backgroundColor: palette.surfaceRaised,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

export function MailListSkeleton({ rows = 6 }: { rows?: number }) {
  const palette = usePalette();
  return (
    <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
      {Array.from({ length: rows }).map((_, index) => (
        <View key={index} style={[styles.row, { borderBottomColor: palette.borderSoft }]}>
          <Skeleton width={44} height={44} radiusSize={14} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Skeleton width="34%" height={11} />
              <Skeleton width={34} height={9} />
            </View>
            <Skeleton width="72%" height={12} />
            <Skeleton width="88%" height={9} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
