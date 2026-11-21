import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { Button } from "./Button";

export type ConfirmTone = "danger" | "warning" | "accent";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  icon?: keyof typeof Feather.glyphMap;
  count?: number;
  details?: { label: string; value: string }[];
  onConfirm?: () => void | Promise<void>;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

function ConfirmDialog({
  request,
  visible,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest | null;
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [rendered, setRendered] = useState(visible);
  const renderedRef = useRef(visible);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const translateY = useRef(new Animated.Value(22)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    renderedRef.current = rendered;
  }, [rendered]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setFailed(false);
      opacity.setValue(0);
      scale.setValue(0.9);
      translateY.setValue(22);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            damping: 18,
            stiffness: 240,
            mass: 0.8,
          }),
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 220,
          }),
        ]).start();
      });
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    if (renderedRef.current) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.95, duration: 150, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 12, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        setRendered(false);
        setBusy(false);
      });
    }
  }, [opacity, pulse, scale, translateY, visible]);

  if (!rendered || !request) return null;

  const tone = request.tone ?? "danger";
  const tint =
    tone === "danger" ? palette.danger : tone === "warning" ? palette.warning : palette.accent;
  const tintSoft =
    tone === "danger" ? palette.dangerSoft : tone === "warning" ? palette.warningSoft : palette.accentSoft;
  const icon = request.icon ?? (tone === "danger" ? "trash-2" : tone === "warning" ? "alert-triangle" : "shield");

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }]}
            onPress={() => {
              if (!busy) onCancel();
            }}
            accessibilityLabel="Close confirmation"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: palette.canvasRaised,
              borderColor: palette.border,
              marginBottom: Math.max(insets.bottom, spacing.xl),
              opacity,
              transform: [{ scale }, { translateY }],
            },
          ]}
        >
          <View style={[styles.topBar, { backgroundColor: tint }]} />
          <View style={[styles.glow, { backgroundColor: tintSoft }]} />
          <View style={styles.content}>
            <View style={styles.iconWrap}>
              <Animated.View
                style={[
                  styles.iconHalo,
                  {
                    backgroundColor: tintSoft,
                    opacity: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.35, 0.75],
                    }),
                    transform: [
                      {
                        scale: pulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.25],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <View style={[styles.icon, { backgroundColor: tintSoft, borderColor: `${tint}55` }]}>
                <Feather name={icon} size={22} color={tint} />
              </View>
            </View>
            <AppText variant="heading" weight="bold" align="center" style={{ letterSpacing: -0.3 }}>
              {request.title}
            </AppText>
            {request.description ? (
              <AppText
                variant="caption"
                color={palette.muted}
                align="center"
                style={{ lineHeight: 19, maxWidth: 310 }}
              >
                {request.description}
              </AppText>
            ) : null}

            {typeof request.count === "number" && request.count > 0 ? (
              <View style={[styles.countPill, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.countBadge, { backgroundColor: tintSoft }]}>
                  <AppText variant="micro" color={tint} style={{ fontSize: 10, letterSpacing: 0 }}>
                    {request.count}
                  </AppText>
                </View>
                <AppText variant="caption" color={palette.inkSoft}>
                  conversation{request.count === 1 ? "" : "s"} selected
                </AppText>
              </View>
            ) : null}

            {request.details?.length ? (
              <View style={[styles.details, { backgroundColor: palette.surface, borderColor: palette.borderSoft }]}>
                {request.details.slice(0, 3).map((detail) => (
                  <View key={detail.label} style={styles.detailRow}>
                    <AppText variant="micro" color={palette.faint} style={{ fontSize: 9, width: 72 }}>
                      {detail.label}
                    </AppText>
                    <AppText variant="caption" numberOfLines={1} style={{ flex: 1, color: palette.inkSoft }}>
                      {detail.value}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}

            {failed ? (
              <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}>
                <Feather name="alert-circle" size={12} color={palette.danger} />
                <AppText variant="caption" color={palette.danger}>
                  Something went wrong. Please try again.
                </AppText>
              </View>
            ) : null}
          </View>

          <View style={[styles.actions, { borderTopColor: palette.borderSoft }]}>
            <Button
              label={request.cancelLabel ?? "Cancel"}
              variant="secondary"
              onPress={onCancel}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Button
              label={request.confirmLabel ?? "Confirm"}
              variant={tone === "accent" ? "primary" : "danger"}
              onPress={() => void handleConfirm()}
              loading={busy}
              style={{ flex: 1 }}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [visible, setVisible] = useState(false);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest((current) => {
          current?.resolve(false);
          return { ...options, resolve };
        });
        setVisible(true);
      }),
    [],
  );

  const finish = useCallback(
    (value: boolean) => {
      request?.resolve(value);
      setVisible(false);
    },
    [request],
  );

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        request={request}
        visible={visible}
        onCancel={() => finish(false)}
        onConfirm={async () => {
          try {
            await request?.onConfirm?.();
            finish(true);
          } catch (caught) {
            throw caught;
          }
        }}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue["confirm"] {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used inside ConfirmProvider");
  return context.confirm;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 22 },
    elevation: 24,
  },
  topBar: { height: 3, width: "100%" },
  glow: {
    position: "absolute",
    top: -60,
    left: "50%",
    marginLeft: -90,
    width: 180,
    height: 120,
    borderRadius: 90,
    opacity: 0.5,
  },
  content: {
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  iconHalo: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 22,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  countPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 5,
    paddingRight: spacing.md,
    paddingVertical: 5,
  },
  countBadge: {
    minWidth: 24,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  details: {
    width: "100%",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: 6,
  },
  detailRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
});
