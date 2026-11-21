import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { hitSlop, radius } from "../../theme/tokens";
import { Touchable } from "./Touchable";

interface IconButtonProps {
  name: keyof typeof Feather.glyphMap;
  onPress?: () => void;
  size?: number;
  iconSize?: number;
  color?: string;
  background?: string;
  border?: boolean;
  variant?: "plain" | "soft" | "solid";
  disabled?: boolean;
  accessibilityLabel: string;
  style?: ViewStyle;
}

export function IconButton({
  name,
  onPress,
  size = 40,
  iconSize = 19,
  color,
  background,
  border = false,
  variant = "plain",
  disabled,
  accessibilityLabel,
  style,
}: IconButtonProps) {
  const palette = usePalette();
  const bg =
    background ??
    (variant === "soft" ? palette.surfaceRaised : variant === "solid" ? palette.accent : "transparent");
  const tint = color ?? (variant === "solid" ? "#FFFFFF" : palette.inkSoft);
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: bg,
          borderWidth: border ? StyleSheet.hairlineWidth : 0,
          borderColor: palette.border,
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <View style={{ alignItems: "center", justifyContent: "center" }}>
        <Feather name={name} size={iconSize} color={tint} />
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
});
