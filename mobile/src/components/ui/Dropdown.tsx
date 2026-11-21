import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { Touchable } from "./Touchable";

export interface DropdownOption {
  key: string;
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  hint?: string;
  selected?: boolean;
  danger?: boolean;
}

interface DropdownProps {
  trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
  options: DropdownOption[];
  onSelect: (key: string) => void;
  title?: string;
  align?: "left" | "right";
  width?: number;
  style?: ViewStyle;
}

const ROW_HEIGHT = 46;

export function Dropdown({
  trigger,
  options,
  onSelect,
  title,
  align = "right",
  width,
  style,
}: DropdownProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const triggerRef = useRef<ViewInstance>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const translateY = useRef(new Animated.Value(-6)).current;

  const panelWidth = Math.min(width ?? 244, screenWidth - 24);
  const panelHeight = options.length * ROW_HEIGHT + (title ? 36 : 0) + 14;

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    triggerRef.current?.measureInWindow((x, y, measuredWidth, height) => {
      setAnchor({ x, y, width: measuredWidth, height });
      setOpen(true);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    opacity.setValue(0);
    scale.setValue(0.94);
    translateY.setValue(-6);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        damping: 20,
        stiffness: 300,
        mass: 0.7,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 280,
      }),
    ]).start();
  }, [opacity, open, scale, translateY]);

  let left = 12;
  let top = insets.top + 60;
  if (anchor) {
    left = align === "right" ? anchor.x + anchor.width - panelWidth : anchor.x;
    left = Math.max(12, Math.min(left, screenWidth - panelWidth - 12));
    const below = anchor.y + anchor.height + 6;
    const above = anchor.y - panelHeight - 6;
    top = below + panelHeight < screenHeight - insets.bottom - 12 ? below : Math.max(insets.top + 12, above);
  }

  return (
    <View ref={triggerRef} style={style} collapsable={false}>
      {trigger({ open, toggle })}
      <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={toggle}>
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
            <Pressable
              style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }]}
              onPress={() => setOpen(false)}
              accessibilityLabel="Close menu"
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.panel,
              {
                left,
                top,
                width: panelWidth,
                backgroundColor: palette.canvasRaised,
                borderColor: palette.border,
                opacity,
                transform: [{ scale }, { translateY }],
              },
            ]}
          >
            {title ? (
              <View style={[styles.titleRow, { borderBottomColor: palette.borderSoft }]}>
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                  {title}
                </AppText>
              </View>
            ) : null}
            {options.map((option) => (
              <Touchable
                key={option.key}
                haptic="light"
                onPress={() => {
                  setOpen(false);
                  requestAnimationFrame(() => onSelect(option.key));
                }}
                accessibilityLabel={option.label}
                accessibilityState={{ selected: option.selected }}
                style={styles.option}
              >
                {option.icon ? (
                  <View
                    style={[
                      styles.icon,
                      {
                        backgroundColor: option.danger
                          ? palette.dangerSoft
                          : option.selected
                            ? palette.accentSoft
                            : palette.surface,
                      },
                    ]}
                  >
                    <Feather
                      name={option.icon}
                      size={14}
                      color={
                        option.danger
                          ? palette.danger
                          : option.selected
                            ? palette.accent
                            : palette.muted
                      }
                    />
                  </View>
                ) : null}
                <View style={{ flex: 1, gap: 1 }}>
                  <AppText
                    variant="small"
                    weight={option.selected ? "semibold" : "medium"}
                    color={option.danger ? palette.danger : palette.ink}
                  >
                    {option.label}
                  </AppText>
                  {option.hint ? (
                    <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                      {option.hint}
                    </AppText>
                  ) : null}
                </View>
                {option.selected ? (
                  <View style={[styles.check, { backgroundColor: palette.accent }]}>
                    <Feather name="check" size={11} color="#FFFFFF" />
                  </View>
                ) : null}
              </Touchable>
            ))}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
    overflow: "hidden",
  },
  titleRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: ROW_HEIGHT,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
