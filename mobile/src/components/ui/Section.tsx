import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { Touchable } from "./Touchable";

export function Section({
  title,
  action,
  children,
  style,
  description,
}: {
  title?: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
  style?: ViewStyle;
  description?: string;
}) {
  const palette = usePalette();
  return (
    <View style={[{ gap: spacing.md }, style]}>
      {title ? (
        <View style={styles.titleRow}>
          <View style={{ gap: 1 }}>
            <AppText variant="micro" color={palette.faint}>
              {title}
            </AppText>
            {description ? (
              <AppText variant="caption" color={palette.faint}>
                {description}
              </AppText>
            ) : null}
          </View>
          {action ? (
            <Touchable onPress={action.onPress} haptic="none" accessibilityLabel={action.label}>
              <AppText variant="caption" weight="semibold" color={palette.accent}>
                {action.label}
              </AppText>
            </Touchable>
          ) : null}
        </View>
      ) : null}
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function SettingRow({
  icon,
  title,
  description,
  value,
  onPress,
  tone,
  last,
  right,
}: {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  tone?: "default" | "danger" | "accent";
  last?: boolean;
  right?: React.ReactNode;
}) {
  const palette = usePalette();
  const color = tone === "danger" ? palette.danger : tone === "accent" ? palette.accent : palette.ink;
  return (
    <Touchable
      onPress={onPress}
      haptic="light"
      disabled={!onPress}
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.borderSoft },
      ]}
      accessibilityLabel={title}
    >
      {icon ? (
        <View
          style={[
            styles.icon,
            {
              backgroundColor:
                tone === "danger" ? palette.dangerSoft : tone === "accent" ? palette.accentSoft : palette.surfaceRaised,
            },
          ]}
        >
          <Feather
            name={icon}
            size={16}
            color={tone === "danger" ? palette.danger : tone === "accent" ? palette.accent : palette.muted}
          />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="small" weight="medium" color={color}>
          {title}
        </AppText>
        {description ? (
          <AppText variant="caption" color={palette.faint}>
            {description}
          </AppText>
        ) : null}
      </View>
      {right ?? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {value ? (
            <AppText variant="caption" color={palette.muted} numberOfLines={1} style={{ maxWidth: 160 }}>
              {value}
            </AppText>
          ) : null}
          {onPress ? <Feather name="chevron-right" size={16} color={palette.faint} /> : null}
        </View>
      )}
    </Touchable>
  );
}

export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  const palette = usePalette();
  return (
    <Touchable
      onPress={() => onChange(!value)}
      haptic="light"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={[
        styles.toggle,
        {
          backgroundColor: value ? palette.accent : palette.surfaceRaised,
          borderColor: value ? palette.accent : palette.borderStrong,
        },
      ]}
    >
      <View
        style={[
          styles.knob,
          {
            backgroundColor: value ? "#FFFFFF" : palette.muted,
            transform: [{ translateX: value ? 18 : 0 }],
          },
        ]}
      />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    minHeight: 58,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  toggle: {
    width: 46,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
});
