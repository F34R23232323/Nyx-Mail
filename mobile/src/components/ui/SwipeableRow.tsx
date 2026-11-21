import React, { useRef } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { Touchable } from "./Touchable";

export interface SwipeAction {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  actions?: SwipeAction[];
  enabled?: boolean;
  style?: ViewStyle;
}

const ACTION_WIDTH = 74;

export function SwipeableRow({ children, actions = [], enabled = true, style }: SwipeableRowProps) {
  const palette = usePalette();
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const width = actions.length * ACTION_WIDTH;

  const settle = (open: boolean) => {
    openRef.current = open;
    Animated.spring(translateX, {
      toValue: open ? -width : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
    }).start();
  };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        enabled &&
        actions.length > 0 &&
        Math.abs(gesture.dx) > 10 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
      onPanResponderMove: (_, gesture) => {
        const base = openRef.current ? -width : 0;
        const next = Math.min(0, Math.max(-width - 20, base + gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const base = openRef.current ? -width : 0;
        const final = base + gesture.dx;
        settle(final < -width * 0.42);
      },
      onPanResponderTerminate: () => settle(openRef.current),
    }),
  ).current;

  if (!enabled || actions.length === 0) {
    return <View style={style}>{children}</View>;
  }

  return (
    <View style={[styles.root, style]}>
      <View style={[styles.actions, { width }]}>
        {actions.map((action) => (
          <Touchable
            key={action.label}
            onPress={() => {
              settle(false);
              requestAnimationFrame(action.onPress);
            }}
            haptic="medium"
            accessibilityLabel={action.label}
            style={[styles.action, { backgroundColor: action.color }]}
          >
            <Feather name={action.icon} size={18} color="#FFFFFF" />
            <AppText variant="micro" color="#FFFFFF" style={{ fontSize: 9, letterSpacing: 0.2 }}>
              {action.label}
            </AppText>
          </Touchable>
        ))}
      </View>
      <Animated.View
        {...responder.panHandlers}
        style={[
          {
            transform: [{ translateX }],
            backgroundColor: palette.canvas,
          },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden" },
  actions: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  action: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
});
