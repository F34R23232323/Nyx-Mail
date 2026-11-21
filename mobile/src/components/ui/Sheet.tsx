import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { IconButton } from "./IconButton";
import { Touchable } from "./Touchable";

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  scrollable?: boolean;
}

export function Sheet({ visible, onClose, title, description, children, footer }: SheetProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const translate = useRef(new Animated.Value(height)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) dragY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 110 || gesture.vy > 0.9) {
            Animated.timing(dragY, {
              toValue: height,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              onCloseRef.current();
            });
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              useNativeDriver: true,
              damping: 22,
              stiffness: 260,
              mass: 0.7,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 22,
            stiffness: 260,
          }).start();
        },
      }),
    [dragY, height],
  );

  useEffect(() => {
    if (visible) {
      translate.setValue(height);
      dragY.setValue(0);
      scrimOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translate, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          mass: 0.9,
          stiffness: 180,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [dragY, height, scrimOpacity, translate, visible]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: scrimOpacity }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }]}
            onPress={() => {
              Keyboard.dismiss();
              onClose();
            }}
            accessibilityLabel="Close"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.canvasRaised,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom, spacing.xl),
              transform: [{ translateY: Animated.add(translate, dragY) }],
            },
          ]}
        >
          <View {...panResponder.panHandlers} style={styles.dragHandle}>
            <View style={[styles.handle, { backgroundColor: palette.borderStrong }]} />
          </View>
          {title || description ? (
            <View style={styles.header}>
              <View style={{ flex: 1, gap: 2 }}>
                {title ? <AppText variant="heading">{title}</AppText> : null}
                {description ? (
                  <AppText variant="caption" color={palette.muted}>
                    {description}
                  </AppText>
                ) : null}
              </View>
              <IconButton
                name="x"
                variant="soft"
                size={34}
                accessibilityLabel="Close"
                onPress={onClose}
                color={palette.muted}
              />
            </View>
          ) : null}
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: spacing.xl }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer ? (
            <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>{footer}</View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ActionSheetItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  tone?: "default" | "danger" | "accent";
  hint?: string;
}

interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  items: ActionSheetItem[];
  children?: React.ReactNode;
}

export function ActionSheet({ visible, onClose, title, items, children }: ActionSheetProps) {
  const palette = usePalette();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ paddingBottom: spacing.xs }}>
        {children}
        {items.map((item) => (
          <Touchable
            key={item.label}
            onPress={() => {
              onClose();
              requestAnimationFrame(item.onPress);
            }}
            haptic="light"
            style={styles.action}
          >
            <View
              style={[
                styles.actionIcon,
                {
                  backgroundColor:
                    item.tone === "danger"
                      ? palette.dangerSoft
                      : item.tone === "accent"
                        ? palette.accentSoft
                        : palette.surface,
                },
              ]}
            >
              <Feather
                name={item.icon}
                size={17}
                color={
                  item.tone === "danger" ? palette.danger
                  : item.tone === "accent" ? palette.accent
                  : palette.inkSoft
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppText
                variant="body"
                weight="medium"
                color={item.tone === "danger" ? palette.danger : palette.ink}
              >
                {item.label}
              </AppText>
              {item.hint ? (
                <AppText variant="caption" color={palette.faint}>
                  {item.hint}
                </AppText>
              ) : null}
            </View>
          </Touchable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    maxHeight: "88%",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -12 },
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    alignSelf: "center",
    opacity: 0.7,
  },
  dragHandle: {
    alignItems: "center",
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
