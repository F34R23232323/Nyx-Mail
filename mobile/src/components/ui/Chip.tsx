import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { Touchable } from "./Touchable";

export function Chip({
  label,
  selected = false,
  onPress,
  count,
  dotColor,
  style,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  count?: number;
  dotColor?: string;
  style?: ViewStyle;
  icon?: keyof typeof Feather.glyphMap;
}) {
  const palette = usePalette();
  return (
    <Touchable
      onPress={onPress}
      haptic="light"
      style={[
        styles.chip,
        {
          backgroundColor: selected ? palette.accentSoft : palette.surface,
          borderColor: selected ? palette.accent : palette.border,
        },
        style,
      ]}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <View style={styles.inner}>
        {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
        {icon ? <Feather name={icon} size={13} color={selected ? palette.accentStrong : palette.muted} /> : null}
        <AppText
          variant="caption"
          weight={selected ? "semibold" : "medium"}
          color={selected ? palette.accentStrong : palette.muted}
        >
          {label}
        </AppText>
        {typeof count === "number" && count > 0 ? (
          <View
            style={[
              styles.count,
              { backgroundColor: selected ? palette.accent : palette.surfaceRaised },
            ]}
          >
            <AppText
              variant="micro"
              color={selected ? "#FFFFFF" : palette.inkSoft}
              style={{ fontSize: 9, letterSpacing: 0 }}
            >
              {count > 99 ? "99+" : String(count)}
            </AppText>
          </View>
        ) : null}
      </View>
    </Touchable>
  );
}

export function Badge({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "accent" | "mint" | "danger" | "warning";
}) {
  const palette = usePalette();
  const map = {
    default: { bg: palette.surfaceRaised, fg: palette.muted },
    accent: { bg: palette.accentSoft, fg: palette.accentStrong },
    mint: { bg: palette.mintSoft, fg: palette.mint },
    danger: { bg: palette.dangerSoft, fg: palette.danger },
    warning: { bg: palette.warningSoft, fg: palette.warning },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <AppText variant="micro" color={map.fg} style={{ fontSize: 9, letterSpacing: 0.4 }}>
        {label}
      </AppText>
    </View>
  );
}

export function CountDot({ count, muted }: { count: number; muted?: boolean }) {
  const palette = usePalette();
  if (!count) return null;
  return (
    <View style={[styles.countDot, { backgroundColor: muted ? palette.surfaceRaised : palette.accent }]}>
      <AppText variant="micro" color={muted ? palette.muted : "#FFFFFF"} style={{ fontSize: 9, letterSpacing: 0 }}>
        {count > 99 ? "99+" : String(count)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    height: 34,
    justifyContent: "center",
  },
  inner: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  count: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  countDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
