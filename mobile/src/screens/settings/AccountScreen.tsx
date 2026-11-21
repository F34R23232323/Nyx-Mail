import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { apiFetch, ApiError } from "../../lib/api";
import { publicKeyFingerprint } from "../../lib/crypto";
import { formatBytes, formatShortDate } from "../../lib/format";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Section, SettingRow } from "../../components/ui/Section";
import { ScreenHeader } from "../../components/ui/EmptyState";
import { TextField } from "../../components/ui/TextField";
import { useToast } from "../../components/ui/Toast";
import { Touchable } from "../../components/ui/Touchable";

export function AccountScreen({ navigation }: RootScreenProps<"Account">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user, baseUrl, refreshUser } = useAuth();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [recoveryEmail, setRecoveryEmail] = useState(user?.recoveryEmail ?? "");
  const [signature, setSignature] = useState(user?.signatureText ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
    setRecoveryEmail(user?.recoveryEmail ?? "");
    setSignature(user?.signatureText ?? "");
  }, [user?.displayName, user?.email, user?.recoveryEmail, user?.signatureText]);

  const dirty =
    displayName !== (user?.displayName ?? "") ||
    recoveryEmail !== (user?.recoveryEmail ?? "") ||
    signature !== (user?.signatureText ?? "");

  const fingerprint = useMemo(() => {
    if (!user?.publicKey) return "";
    try {
      return publicKeyFingerprint(user.publicKey);
    } catch {
      return "";
    }
  }, [user?.publicKey]);

  const save = async () => {
    setError(null);
    if (!displayName.trim()) return setError("Display name cannot be empty.");
    if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.trim())) {
      return setError("Recovery email is not valid.");
    }
    setBusy(true);
    try {
      await apiFetch("/api/v1/account", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim(),
          recoveryEmail: recoveryEmail.trim() || null,
          signatureText: signature.trim() || null,
          signatureHtml: null,
        }),
      });
      await refreshUser();
      toast({ title: "Profile updated", tone: "success" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
      <ScreenHeader title="Account" subtitle="Profile, signature and address" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: "center", gap: spacing.md }}>
            <Avatar name={displayName || user?.displayName} email={user?.email} size={78} ring />
            <View style={{ alignItems: "center", gap: 2 }}>
              <AppText variant="heading" weight="semibold">
                {displayName || user?.displayName}
              </AppText>
              <AppText variant="caption" color={palette.muted}>
                {user?.email}
              </AppText>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={[styles.pill, { backgroundColor: palette.mintSoft }]}>
                <Feather name="shield" size={9} color={palette.mint} />
                <AppText variant="micro" color={palette.mint} style={{ fontSize: 8 }}>
                  Zero-access
                </AppText>
              </View>
              {user?.isAdmin ? (
                <View style={[styles.pill, { backgroundColor: palette.accentSoft }]}>
                  <Feather name="zap" size={9} color={palette.accent} />
                  <AppText variant="micro" color={palette.accentStrong} style={{ fontSize: 8 }}>
                    Administrator
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          <Section title="PROFILE">
            <View style={{ padding: spacing.lg, gap: spacing.lg }}>
              <TextField
                label="Display name"
                icon="user"
                value={displayName}
                onChangeText={(value) => {
                  setDisplayName(value);
                  setError(null);
                }}
                maxLength={80}
              />
              <TextField
                label="Recovery email"
                icon="life-buoy"
                value={recoveryEmail}
                onChangeText={(value) => {
                  setRecoveryEmail(value);
                  setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                hint="Used for account notices. Never used to decrypt mail."
              />
              <View style={{ gap: spacing.sm }}>
                <TextField
                  label="Email signature"
                  icon="edit-3"
                  value={signature}
                  onChangeText={(value) => {
                    setSignature(value);
                    setError(null);
                  }}
                  placeholder="Sent with NyxMail — encrypted end to end."
                  multiline
                  numberOfLines={4}
                  maxLength={2000}
                  style={{ minHeight: 90, textAlignVertical: "top", paddingTop: spacing.md }}
                  error={error}
                />
                <AppText variant="caption" color={palette.faint}>
                  Added automatically to new messages as encrypted plain text.
                </AppText>
              </View>
              <Button
                label={busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
                icon="check"
                loading={busy}
                disabled={!dirty}
                onPress={save}
              />
            </View>
          </Section>

          <Section title="ENCRYPTION">
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <View style={[styles.keyIcon, { backgroundColor: palette.accentSoft }]}>
                  <Feather name="key" size={17} color={palette.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" weight="semibold">
                    X25519 public key fingerprint
                  </AppText>
                  <AppText
                    variant="caption"
                    color={palette.faint}
                    style={{ fontSize: 10, letterSpacing: 0.6, lineHeight: 17 }}
                  >
                    {fingerprint || "Unavailable"}
                  </AppText>
                </View>
              </View>
              <View style={[styles.note, { backgroundColor: palette.surfaceRaised }]}>
                <Feather name="lock" size={12} color={palette.mint} />
                <AppText variant="caption" color={palette.muted} style={{ flex: 1, lineHeight: 18 }}>
                  The private half of this key exists only inside your encrypted key bundle on this
                  device. NyxMail cannot read your messages.
                </AppText>
              </View>
            </View>
          </Section>

          <Section title="MAILBOX">
            <SettingRow
              icon="at-sign"
              title="Aliases"
              description="Additional addresses you can send from"
              onPress={() => navigation.navigate("Aliases")}
            />
            <SettingRow
              icon="hard-drive"
              title="Storage"
              value={`${formatBytes(user?.storageUsedBytes ?? 0)} / ${formatBytes(
                user?.storageLimitBytes ?? 0,
              )}`}
            />
            <SettingRow
              icon="calendar"
              title="Member since"
              value={user ? formatShortDate(user.createdAt) : ""}
              last
            />
          </Section>

          <Touchable
            onPress={() => Linking.openURL(`${baseUrl}/settings`).catch(() => undefined)}
            haptic="light"
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center" }}
          >
            <Feather name="external-link" size={13} color={palette.faint} />
            <AppText variant="caption" color={palette.faint}>
              Change email or password in the web app
            </AppText>
          </Touchable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  keyIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
