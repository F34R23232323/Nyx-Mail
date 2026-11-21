import React, { useCallback, useContext, useMemo, useRef, useState, createContext } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";

type Tone = "default" | "success" | "error" | "info" | "warning";

interface ToastAction {
  label: string;
  onPress: () => void | Promise<void>;
}

interface ToastOptions {
  title: string;
  description?: string;
  tone?: Tone;
  duration?: number;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ToastOptions | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const generation = useRef(0);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    progressAnimation.current?.stop();
    const currentGeneration = generation.current;
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 170, useNativeDriver: true }),
    ]).start(() => {
      if (generation.current === currentGeneration) setCurrent(null);
    });
  }, [opacity, translateY]);

  const toast = useCallback(
    (options: ToastOptions) => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      progressAnimation.current?.stop();
      setCurrent(options);
      translateY.setValue(-120);
      opacity.setValue(0);
      progress.setValue(1);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 18,
          stiffness: 230,
          mass: 0.8,
        }),
        Animated.timing(opacity, { toValue: 1, duration: 170, useNativeDriver: true }),
      ]).start();
      const duration = options.duration ?? (options.action ? 6500 : 3400);
      progressAnimation.current = Animated.timing(progress, {
        toValue: 0,
        duration,
        useNativeDriver: false,
      });
      progressAnimation.current.start();
      timer.current = setTimeout(hide, duration);
    },
    [hide, opacity, progress, translateY],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  const tone = current?.tone ?? "default";
  const icon =
    tone === "success" ? "check-circle"
    : tone === "error" ? "alert-triangle"
    : tone === "warning" ? "alert-octagon"
    : tone === "info" ? "info"
    : "bell";
  const tint =
    tone === "success" ? palette.mint
    : tone === "error" ? palette.danger
    : tone === "warning" ? palette.warning
    : tone === "info" ? palette.accent
    : palette.inkSoft;
  const soft =
    tone === "success" ? palette.mintSoft
    : tone === "error" ? palette.dangerSoft
    : tone === "warning" ? palette.warningSoft
    : tone === "info" ? palette.accentSoft
    : palette.overlay;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {current ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            {
              top: insets.top + spacing.sm,
              transform: [{ translateY }],
              opacity,
            },
          ]}
        >
          <View
            style={[
              styles.toast,
              {
                backgroundColor: palette.surfaceRaised,
                borderColor: palette.borderStrong,
              },
            ]}
          >
            <View style={[styles.icon, { backgroundColor: soft }]}>
              <Feather name={icon} size={17} color={tint} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="small" weight="semibold" numberOfLines={1}>
                {current.title}
              </AppText>
              {current.description ? (
                <AppText variant="caption" color={palette.muted} numberOfLines={2}>
                  {current.description}
                </AppText>
              ) : null}
            </View>
            {current.action ? (
              <Pressable
                onPress={() => {
                  const action = current.action;
                  hide();
                  requestAnimationFrame(() => void action?.onPress());
                }}
                style={[styles.action, { borderColor: palette.borderStrong }]}
                accessibilityLabel={current.action.label}
              >
                <AppText variant="caption" weight="semibold" color={tint}>
                  {current.action.label}
                </AppText>
              </Pressable>
            ) : null}
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progress,
                  {
                    backgroundColor: tint,
                    width: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"],
                    }),
                  },
                ]}
              />
            </View>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    zIndex: 1000,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    overflow: "hidden",
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  progress: { height: 2, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
});
