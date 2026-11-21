import React from "react";
import { StyleSheet, Text, type TextProps } from "react-native";
import { usePalette } from "../../theme/ThemeProvider";
import { fontSize, fontWeight } from "../../theme/tokens";

type Variant =
  | "hero"
  | "display"
  | "title"
  | "heading"
  | "body"
  | "small"
  | "caption"
  | "micro"
  | "label";

interface AppTextProps extends TextProps {
  variant?: Variant;
  color?: string;
  weight?: keyof typeof fontWeight;
  align?: "left" | "center" | "right";
  tracking?: number;
}

const variantStyles: Record<Variant, { size: number; weight: keyof typeof fontWeight; line?: number; tracking?: number; upper?: boolean }> = {
  hero: { size: fontSize.hero, weight: "bold", line: 40, tracking: -1.1 },
  display: { size: fontSize.display, weight: "bold", line: 34, tracking: -0.8 },
  title: { size: fontSize.heading, weight: "semibold", line: 26, tracking: -0.35 },
  heading: { size: fontSize.title, weight: "semibold", line: 22, tracking: -0.2 },
  body: { size: fontSize.body, weight: "regular", line: 22 },
  small: { size: fontSize.small, weight: "regular", line: 19 },
  caption: { size: fontSize.caption, weight: "regular", line: 17 },
  micro: { size: fontSize.micro, weight: "semibold", line: 14, tracking: 0.8, upper: true },
  label: { size: fontSize.caption, weight: "semibold", line: 16, tracking: 0.2 },
};

export function AppText({
  variant = "body",
  color,
  weight,
  align,
  tracking,
  style,
  children,
  ...rest
}: AppTextProps) {
  const palette = usePalette();
  const config = variantStyles[variant];
  const text = config.upper && typeof children === "string" ? children.toUpperCase() : children;
  return (
    <Text
      {...rest}
      allowFontScaling={rest.allowFontScaling ?? true}
      style={[
        {
          color: color ?? (variant === "caption" || variant === "micro" ? palette.muted : palette.ink),
          fontSize: config.size,
          lineHeight: config.line,
          fontFamily:
            weight === "regular" ? "Inter_400Regular"
            : weight === "medium" ? "Inter_500Medium"
            : weight === "semibold" ? "Inter_600SemiBold"
            : weight === "bold" ? "Inter_700Bold"
            : weight === "heavy" ? "Inter_800ExtraBold"
            : config.weight === "regular" ? "Inter_400Regular"
            : config.weight === "medium" ? "Inter_500Medium"
            : config.weight === "semibold" ? "Inter_600SemiBold"
            : config.weight === "bold" ? "Inter_700Bold"
            : "Inter_800ExtraBold",
          letterSpacing: tracking ?? config.tracking,
          textAlign: align,
        },
        style,
      ]}
    >
      {text}
    </Text>
  );
}

export const textStyles = StyleSheet.create({
  tabular: { fontVariant: ["tabular-nums"] },
});
