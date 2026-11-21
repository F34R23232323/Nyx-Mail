import React from "react";
import { ActivityIndicator, StyleSheet, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { Touchable } from "./Touchable";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "mint";

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: keyof typeof Feather.glyphMap;
  iconRight?: keyof typeof Feather.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
}: ButtonProps) {
  const palette = usePalette();
  const height = size === "sm" ? 38 : size === "lg" ? 54 : 48;
  const pad = size === "sm" ? spacing.lg : spacing.xl;

  const background =
    variant === "primary" ? palette.accent
    : variant === "secondary" ? palette.surfaceRaised
    : variant === "danger" ? palette.dangerSoft
    : variant === "mint" ? palette.mintSoft
    : "transparent";
  const textColor =
    variant === "primary" ? "#FFFFFF"
    : variant === "danger" ? palette.danger
    : variant === "mint" ? palette.mint
    : variant === "secondary" ? palette.ink
    : palette.muted;
  const borderColor =
    variant === "secondary" ? palette.border : "transparent";

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || loading}
      haptic={variant === "primary" ? "medium" : "light"}
      style={[
        styles.base,
        {
          height,
          paddingHorizontal: pad,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          backgroundColor: variant === "primary" ? "transparent" : background,
          borderColor,
          borderWidth: variant === "secondary" ? StyleSheet.hairlineWidth : 0,
          opacity: disabled ? 0.5 : 1,
          overflow: "hidden",
          shadowColor: palette.accent,
          shadowOpacity: variant === "primary" ? 0.35 : 0,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: variant === "primary" ? 6 : 0,
        },
        style,
      ]}
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {variant === "primary" ? (
        <LinearGradient
          colors={[palette.accentStrong, palette.accent, palette.gradient[2]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : icon ? (
          <Feather name={icon} size={size === "sm" ? 15 : 17} color={textColor} />
        ) : null}
        <AppText
          variant={size === "sm" ? "caption" : "body"}
          weight="semibold"
          color={textColor}
          style={{ letterSpacing: 0.1 }}
        >
          {label}
        </AppText>
        {iconRight && !loading ? (
          <Feather name={iconRight} size={size === "sm" ? 15 : 17} color={textColor} />
        ) : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
});
