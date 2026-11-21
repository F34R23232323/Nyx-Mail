import React from "react";
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

type Haptic = "none" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

interface TouchableProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  haptic?: Haptic;
  scaleTo?: number;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Touchable({
  style,
  children,
  haptic = "light",
  scaleTo = 0.975,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: TouchableProps) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(1)).current;

  const animate = (toScale: number, toOpacity: number) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: toScale,
        useNativeDriver: true,
        speed: 40,
        bounciness: 0,
      }),
      Animated.timing(opacity, { toValue: toOpacity, duration: 90, useNativeDriver: true }),
    ]).start();
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      {...rest}
      onPressIn={(event) => {
        animate(scaleTo, 0.86);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1, 1);
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (disabled) return;
        if (haptic !== "none") {
          const map: Record<Exclude<Haptic, "none">, () => void> = {
            light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
            medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
            heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined),
            success: () =>
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
            warning: () =>
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
            error: () =>
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
          };
          map[haptic]();
        }
        rest.onPress?.(event);
      }}
      style={[style as ViewStyle, { transform: [{ scale }], opacity }]}
    >
      {children}
    </AnimatedPressable>
  );
}
