import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { displaySender } from "../../lib/format";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { LogoMark } from "../../components/ui/Logo";
import { TextField } from "../../components/ui/TextField";
import { Touchable } from "../../components/ui/Touchable";
import { OtpInput } from "../../components/auth/OtpInput";

export function MfaScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { pendingMfa, completeMfa, cancelMfa, unlockProgress } = useAuth();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pendingMfa) return null;

  const canTotp = pendingMfa.methods.includes("totp");
  const verify = async (value = code) => {
    if (busy) return;
    const cleaned = value.trim();
    if (!cleaned) return setError(backup ? "Enter a backup code." : "Enter your 6-digit code.");
    setBusy(true);
    setError(null);
    try {
      await completeMfa(cleaned, backup ? "backup" : "totp");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Verification failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <LinearGradient
        colors={["rgba(138,120,255,0.2)", "rgba(8,9,13,0)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topBar}>
            <IconButton name="arrow-left" onPress={cancelMfa} accessibilityLabel="Back to sign in" />
            <LogoMark size={34} />
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.center}>
            <View
              style={[
                styles.shield,
                { backgroundColor: palette.accentSoft, borderColor: "rgba(138,120,255,0.25)" },
              ]}
            >
              <Feather name="shield" size={28} color={palette.accent} />
              <View style={[styles.keyDot, { backgroundColor: palette.mint, borderColor: palette.canvas }]}>
                <Feather name="key" size={8} color={palette.canvas} />
              </View>
            </View>
            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <AppText variant="display" align="center">
                Two-factor check
              </AppText>
              <AppText variant="small" color={palette.muted} align="center" style={{ maxWidth: 300 }}>
                Signing in as{" "}
                <AppText variant="small" weight="semibold" color={palette.inkSoft}>
                  {displaySender(pendingMfa.displayName, pendingMfa.email)}
                </AppText>
                {"\n"}
                {pendingMfa.email}
              </AppText>
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              {backup ? (
                <TextField
                  label="One-time backup code"
                  placeholder="XXXX-XXXX"
                  icon="key"
                  value={code}
                  onChangeText={(value) => setCode(value.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoFocus
                />
              ) : (
                <OtpInput
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    setError(null);
                  }}
                  error={Boolean(error)}
                  onComplete={(value) => void verify(value)}
                />
              )}

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

              <Button
                label={busy ? "Deriving your key…" : "Verify & unlock"}
                icon="unlock"
                size="lg"
                loading={busy}
                onPress={() => void verify()}
              />
              {busy ? (
                <View style={{ gap: spacing.sm }}>
                  <View style={[styles.progressTrack, { backgroundColor: palette.surfaceRaised }]}>
                    <View
                      style={[
                        styles.progressBar,
                        {
                          backgroundColor: palette.accent,
                          width: `${Math.max(4, Math.round(unlockProgress * 100))}%`,
                        },
                      ]}
                    />
                  </View>
                  <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                    Argon2id · 64 MiB · {Math.round(unlockProgress * 100)}% · on this device
                  </AppText>
                </View>
              ) : null}
            </View>

            <View style={{ gap: spacing.lg, alignItems: "center" }}>
              {backup && canTotp ? (
                <Touchable
                  onPress={() => {
                    setBackup(false);
                    setCode("");
                    setError(null);
                  }}
                  haptic="light"
                >
                  <AppText variant="small" weight="medium" color={palette.accentStrong}>
                    Use authenticator code
                  </AppText>
                </Touchable>
              ) : canTotp ? (
                <Touchable
                  onPress={() => {
                    setBackup(true);
                    setCode("");
                    setError(null);
                  }}
                  haptic="light"
                >
                  <AppText variant="small" weight="medium" color={palette.accentStrong}>
                    Use a backup code
                  </AppText>
                </Touchable>
              ) : null}
              {pendingMfa.hasPasskeys ? (
                <AppText variant="caption" color={palette.faint} align="center">
                  Passkeys are available from the NyxMail web app.
                </AppText>
              ) : null}
            </View>
          </View>

          <View style={{ marginTop: "auto", paddingTop: spacing.xxxl }}>
            <View style={styles.tip}>
              <Feather name="clock" size={13} color={palette.faint} />
              <AppText variant="caption" color={palette.faint} style={{ flex: 1 }}>
                Codes rotate every 30 seconds. Make sure your device clock is accurate.
              </AppText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { flex: 1, justifyContent: "center", gap: spacing.xxl, paddingTop: spacing.xxxl },
  shield: {
    width: 76,
    height: 76,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    borderWidth: 1,
  },
  keyDot: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  card: {
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.xl,
  },
  errorBox: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  tip: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressBar: { height: 5, borderRadius: 3 },
});
