import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

interface EmptyStateProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, actionLabel, onAction, compact }: EmptyStateProps) {
  const palette = usePalette();
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  return (
    <View style={[styles.wrap, compact && { paddingVertical: spacing.xxxl }]}>
      <Animated.View
        style={{
          transform: [
            {
              translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }),
            },
          ],
        }}
      >
        <View
          style={[
            styles.iconOuter,
            { backgroundColor: palette.accentFaint, borderColor: palette.accentSoft },
          ]}
        >
          <View style={[styles.iconInner, { backgroundColor: palette.surface }]}>
            <Feather name={icon} size={24} color={palette.accent} />
          </View>
        </View>
      </Animated.View>
      <View style={{ gap: spacing.sm, alignItems: "center" }}>
        <AppText variant="heading" weight="semibold" align="center">
          {title}
        </AppText>
        {description ? (
          <AppText
            variant="small"
            color={palette.muted}
            align="center"
            style={{ maxWidth: 280, lineHeight: 21 }}
          >
            {description}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} size="sm" fullWidth={false} icon="plus" />
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "Something went wrong",
}: {
  message?: string;
  onRetry?: () => void;
  title?: string;
}) {
  const palette = usePalette();
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.iconOuter,
          { backgroundColor: palette.dangerSoft, borderColor: palette.dangerSoft },
        ]}
      >
        <View style={[styles.iconInner, { backgroundColor: palette.surface }]}>
          <Feather name="wifi-off" size={24} color={palette.danger} />
        </View>
      </View>
      <View style={{ gap: spacing.sm, alignItems: "center" }}>
        <AppText variant="heading" align="center">
          {title}
        </AppText>
        {message ? (
          <AppText variant="small" color={palette.muted} align="center" style={{ maxWidth: 300 }}>
            {message}
          </AppText>
        ) : null}
      </View>
      {onRetry ? (
        <Button label="Try again" onPress={onRetry} size="sm" variant="secondary" fullWidth={false} icon="refresh-cw" />
      ) : null}
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  large,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  large?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.header, { borderBottomColor: palette.borderSoft }]}>
      {onBack ? (
        <IconButton name="arrow-left" onPress={onBack} accessibilityLabel="Go back" size={38} />
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant={large ? "display" : "heading"} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={palette.muted} numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.huge,
    gap: spacing.xl,
  },
  iconOuter: {
    width: 76,
    height: 76,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    transform: [{ rotate: "-6deg" }],
  },
  iconInner: {
    width: 56,
    height: 56,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "6deg" }],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
