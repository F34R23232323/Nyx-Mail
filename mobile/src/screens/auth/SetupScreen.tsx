import React, { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { LogoMark } from "../../components/ui/Logo";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";
import { OtpInput } from "../../components/auth/OtpInput";

export function SetupScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { pendingSetup, completeSetup, cancelMfa } = useAuth();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pendingSetup) return null;

  const enable = async (value = code) => {
    if (busy) return;
    if (value.trim().length < 6) return setError("Enter the 6-digit code from your authenticator.");
    setBusy(true);
    setError(null);
    try {
      const codes = await completeSetup(value);
      if (codes.length) {
        toast({
          title: "Two-factor enabled",
          description: "Your one-time backup codes are ready.",
          tone: "success",
        });
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not enable two-factor authentication.");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    await Clipboard.setStringAsync(pendingSetup.otpauthUri);
    toast({ title: "Setup link copied", tone: "success" });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.xl,
            gap: spacing.xxl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <IconButton name="arrow-left" onPress={cancelMfa} accessibilityLabel="Back to sign in" />
            <LogoMark size={34} />
            <View style={{ width: 40 }} />
          </View>

          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Feather name="shield" size={14} color={palette.accent} />
              <AppText variant="micro" color={palette.accentStrong}>
                Required security step
              </AppText>
            </View>
            <AppText variant="display">Set up two-factor</AppText>
            <AppText variant="small" color={palette.muted} style={{ lineHeight: 21 }}>
              Your account was created but two-factor is not active yet. Scan the QR code with
              1Password, Authy, Google Authenticator or any TOTP app.
            </AppText>
          </View>

          <View
            style={[
              styles.qrCard,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <View style={styles.qrWrap}>
              <Image
                source={{ uri: pendingSetup.qrDataUrl }}
                style={{ width: 208, height: 208 }}
                resizeMode="contain"
              />
            </View>
            <Touchable onPress={copySecret} haptic="light" style={{ alignSelf: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Feather name="copy" size={13} color={palette.accent} />
                <AppText variant="caption" weight="medium" color={palette.accentStrong}>
                  Copy setup link
                </AppText>
              </View>
            </Touchable>
            <View style={[styles.divider, { backgroundColor: palette.borderSoft }]} />
            <View style={{ gap: spacing.lg }}>
              <AppText variant="label" color={palette.muted}>
                Enter the code your app shows
              </AppText>
              <OtpInput
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setError(null);
                }}
                error={Boolean(error)}
                autoFocus={false}
                onComplete={(value) => void enable(value)}
              />
            </View>
            {error ? (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: palette.dangerSoft, borderColor: "rgba(255,113,133,0.22)" },
                ]}
              >
                <Feather name="alert-circle" size={15} color={palette.danger} />
                <AppText variant="caption" color={palette.danger} style={{ flex: 1 }}>
                  {error}
                </AppText>
              </View>
            ) : null}
            <Button label="Enable & finish" icon="shield" size="lg" loading={busy} onPress={() => void enable()} />
          </View>

          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <Feather name="info" size={13} color={palette.faint} style={{ marginTop: 2 }} />
            <AppText variant="caption" color={palette.faint} style={{ flex: 1, lineHeight: 18 }}>
              Save your backup codes when they appear. They are the only way back in if you lose your
              authenticator and recovery kit.
            </AppText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  qrCard: {
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  qrWrap: {
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  divider: { height: StyleSheet.hairlineWidth },
  errorBox: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
});
