import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { ApiError, probeServer } from "../../lib/api";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Logo } from "../../components/ui/Logo";
import { TextField } from "../../components/ui/TextField";
import { Sheet } from "../../components/ui/Sheet";
import { Touchable } from "../../components/ui/Touchable";

export function LoginScreen({ navigation }: RootScreenProps<"Login">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { signIn, baseUrl, changeServer } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverValue, setServerValue] = useState(baseUrl);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!baseUrl) {
      setServerValue("");
      setServerError(null);
      setServerOpen(true);
      setError("Choose your mail server first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveServer = async () => {
    setServerBusy(true);
    setServerError(null);
    try {
      const result = await probeServer(serverValue);
      await changeServer(result.baseUrl);
      setServerOpen(false);
    } catch (caught) {
      setServerError(caught instanceof ApiError ? caught.message : "That server could not be reached.");
    } finally {
      setServerBusy(false);
    }
  };

  const serverLabel = baseUrl ? baseUrl.replace(/^https?:\/\//, "") : "Choose server";

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <LinearGradient
        colors={["rgba(138,120,255,0.22)", "rgba(8,9,13,0)"]}
        start={{ x: 0.8, y: 0 }}
        end={{ x: 0.4, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.glow,
          { backgroundColor: palette.pink, opacity: palette.mode === "dark" ? 0.055 : 0.05 },
        ]}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Logo size={36} />
            <Touchable
              onPress={() => {
                setServerValue(baseUrl);
                setServerError(null);
                setServerOpen(true);
              }}
              haptic="light"
              accessibilityLabel="Mail server"
              style={[
                styles.serverPill,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: palette.mint }]} />
              <AppText variant="caption" color={palette.muted} numberOfLines={1} style={{ maxWidth: 150 }}>
                {serverLabel}
              </AppText>
              <Feather name="chevron-down" size={13} color={palette.faint} />
            </Touchable>
          </View>

          <View style={styles.hero}>
            <View
              style={[
                styles.encryptedBadge,
                { backgroundColor: palette.accentSoft, borderColor: "rgba(138,120,255,0.28)" },
              ]}
            >
              <Feather name="lock" size={11} color={palette.accentStrong} />
              <AppText variant="micro" color={palette.accentStrong} style={{ fontSize: 9 }}>
                Zero-access encryption
              </AppText>
            </View>
            <AppText variant="hero" weight="bold" style={{ lineHeight: 41 }}>
              Your inbox.{"\n"}Only yours.
            </AppText>
            <AppText variant="small" color={palette.muted} style={{ maxWidth: 310, lineHeight: 21 }}>
              NyxMail decrypts your mail on this device. The server only ever stores ciphertext.
            </AppText>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: palette.mode === "dark" ? "rgba(17,19,26,0.9)" : palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={{ gap: spacing.lg }}>
              <TextField
                label="Email address"
                placeholder="you@yourdomain.com"
                icon="at-sign"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
              />
              <TextField
                label="Password"
                placeholder="Your account password"
                icon="key"
                value={password}
                onChangeText={setPassword}
                secure
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
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
                <AppText variant="caption" color={palette.danger} style={{ flex: 1, lineHeight: 18 }}>
                  {error}
                </AppText>
              </View>
            ) : null}

            <Button
              label={busy ? "Signing in…" : "Unlock mailbox"}
              onPress={submit}
              loading={busy}
              size="lg"
              icon="arrow-right"
            />

            <View style={styles.linkRow}>
              <Feather name="lock" size={12} color={palette.faint} />
              <AppText variant="caption" color={palette.faint} style={{ flex: 1, lineHeight: 17 }}>
                Your password derives your private key locally and is never stored on the server.
              </AppText>
            </View>
          </View>

          <View style={styles.bottom}>
            <Touchable onPress={() => navigation.navigate("Signup")} haptic="light">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <AppText variant="small" color={palette.muted}>
                  New to NyxMail?
                </AppText>
                <AppText variant="small" weight="semibold" color={palette.accentStrong}>
                  Create an account
                </AppText>
              </View>
            </Touchable>
            <View style={styles.securityRow}>
              <View style={styles.securityItem}>
                <Feather name="shield" size={12} color={palette.faint} />
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                  Argon2id
                </AppText>
              </View>
              <View style={[styles.sep, { backgroundColor: palette.border }]} />
              <View style={styles.securityItem}>
                <Feather name="key" size={12} color={palette.faint} />
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                  X25519
                </AppText>
              </View>
              <View style={[styles.sep, { backgroundColor: palette.border }]} />
              <View style={styles.securityItem}>
                <Feather name="smartphone" size={12} color={palette.faint} />
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                  TOTP 2FA
                </AppText>
              </View>
            </View>
            <Touchable
              haptic="none"
              onPress={() => Linking.openURL(`${baseUrl}/recover`).catch(() => undefined)}
            >
              <AppText variant="caption" color={palette.faint} align="center">
                Lost access? Recover with your 24-word kit
              </AppText>
            </Touchable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet
        visible={serverOpen}
        onClose={() => setServerOpen(false)}
        title="Mail server"
        description="Point the app at any NyxMail instance."
      >
        <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
          <TextField
            label="Server address"
            placeholder="https://mail.example.com"
            icon="globe"
            value={serverValue}
            onChangeText={setServerValue}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={serverError}
            hint="Use HTTPS. The server must expose the NyxMail API."
          />
          <Button label="Test & save" onPress={saveServer} loading={serverBusy} size="lg" icon="zap" />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  serverPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  hero: { marginTop: spacing.huge, marginBottom: spacing.xxl, gap: spacing.lg },
  encryptedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
  errorBox: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  linkRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  bottom: { marginTop: "auto", paddingTop: spacing.xxxl, alignItems: "center", gap: spacing.xl },
  securityRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  securityItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  sep: { width: StyleSheet.hairlineWidth, height: 10 },
  glow: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    right: -150,
    top: 260,
  },
});
