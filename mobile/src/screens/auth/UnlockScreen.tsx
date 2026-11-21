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
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { LogoMark } from "../../components/ui/Logo";
import { TextField } from "../../components/ui/TextField";
import { Touchable } from "../../components/ui/Touchable";

export function UnlockScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user, unlock, signOut, unlockProgress, unlockBusy, error: authError } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) return setError("Enter your password to unlock your mailbox.");
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not unlock your keys.");
    } finally {
      setBusy(false);
    }
  };

  const progress = Math.round(unlockProgress * 100);
  const working = busy || unlockBusy;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <LinearGradient
        colors={["rgba(138,120,255,0.18)", "rgba(8,9,13,0)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topBar}>
            <LogoMark size={34} />
            <Touchable onPress={() => void signOut()} haptic="light">
              <AppText variant="caption" weight="medium" color={palette.muted}>
                Use another account
              </AppText>
            </Touchable>
          </View>

          <View style={styles.center}>
            <View>
              <Avatar
                name={user?.displayName}
                email={user?.email}
                size={78}
                ring
              />
              <View
                style={[
                  styles.lockBadge,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <Feather name="lock" size={13} color={palette.accent} />
              </View>
            </View>
            <View style={{ alignItems: "center", gap: spacing.sm }}>
              <AppText variant="display" align="center">
                Welcome back
              </AppText>
              <AppText variant="small" color={palette.muted} align="center">
                {displaySender(user?.displayName, user?.email)}
                {"\n"}
                <AppText variant="caption" color={palette.faint}>
                  {user?.email}
                </AppText>
              </AppText>
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <TextField
                label="Password"
                placeholder="Enter your password"
                icon="key"
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setError(null);
                }}
                secure
                autoFocus
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                editable={!working}
              />

              {working ? (
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <AppText variant="caption" color={palette.muted}>
                      Deriving your private key…
                    </AppText>
                    <AppText variant="caption" color={palette.accentStrong} weight="semibold">
                      {progress}%
                    </AppText>
                  </View>
                  <View style={[styles.track, { backgroundColor: palette.surfaceRaised }]}>
                    <View
                      style={[
                        styles.bar,
                        {
                          backgroundColor: palette.accent,
                          width: `${Math.max(5, progress)}%`,
                        },
                      ]}
                    />
                  </View>
                  <AppText variant="caption" color={palette.faint}>
                    Argon2id · 64 MiB · performed entirely on this device
                  </AppText>
                </View>
              ) : null}

              {error ?? authError ? (
                <View
                  style={[
                    styles.errorBox,
                    { backgroundColor: palette.dangerSoft, borderColor: "rgba(255,113,133,0.22)" },
                  ]}
                >
                  <Feather name="alert-circle" size={15} color={palette.danger} />
                  <AppText variant="caption" color={palette.danger} style={{ flex: 1 }}>
                    {error ?? authError}
                  </AppText>
                </View>
              ) : null}

              <Button
                label={working ? "Unlocking securely…" : "Unlock mailbox"}
                icon="unlock"
                size="lg"
                loading={working}
                onPress={submit}
              />
            </View>

            <View style={styles.privacyRow}>
              <Feather name="shield" size={13} color={palette.mint} />
              <AppText variant="caption" color={palette.faint} style={{ flex: 1, lineHeight: 18 }}>
                The password never leaves this phone. It only unwraps the private key stored on the
                server.
              </AppText>
            </View>
          </View>

          <AppText variant="micro" color={palette.faint} align="center" style={{ marginTop: "auto" }}>
            Auto-locks after 5 minutes in the background
          </AppText>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.xxl, paddingVertical: spacing.xxxl },
  lockBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    width: "100%",
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
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  bar: { height: 6, borderRadius: 3 },
  privacyRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingHorizontal: spacing.sm },
});
