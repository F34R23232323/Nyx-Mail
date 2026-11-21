import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
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
import { formatRelativeTime } from "../../lib/format";
import type { SessionDTO } from "../../lib/types";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenHeader } from "../../components/ui/EmptyState";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { Section, SettingRow } from "../../components/ui/Section";
import { IconButton } from "../../components/ui/IconButton";
import { useToast } from "../../components/ui/Toast";

function deviceLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (/iphone|ios/.test(ua)) return "iPhone";
  if (/ipad/.test(ua)) return "iPad";
  if (/android/.test(ua)) {
    const match = /android\s+([\d.]+)/.exec(ua);
    return match ? `Android ${match[1]}` : "Android device";
  }
  if (/macintosh|mac os/.test(ua)) return "Mac";
  if (/windows/.test(ua)) return "Windows PC";
  if (/linux/.test(ua)) return "Linux device";
  if (/okhttp|nyxmail|expo/.test(ua)) return "NyxMail Mobile";
  return "Unknown device";
}

function browserLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("nyxmail") || ua.includes("expo") || ua.includes("okhttp")) return "NyxMail Mobile";
  if (ua.includes("chrome")) return "Chrome";
  if (ua.includes("firefox")) return "Firefox";
  if (ua.includes("safari")) return "Safari";
  if (ua.includes("edge")) return "Edge";
  return "Browser";
}

export function SecurityScreen({ navigation }: RootScreenProps<"Security">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user, keys, baseUrl, lock, signOut } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fingerprint = useMemo(() => {
    if (!user?.publicKey) return "";
    try {
      return publicKeyFingerprint(user.publicKey);
    } catch {
      return "";
    }
  }, [user?.publicKey]);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await apiFetch<{ sessions: SessionDTO[] }>("/api/v1/sessions");
      setSessions(data.sessions);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Sessions could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const revoke = (session: SessionDTO) => {
    void confirm({
      title: session.current ? "Sign out this device?" : "Revoke this session?",
      description: session.current
        ? "You will need your password and authenticator to sign in again."
        : `${deviceLabel(session.userAgent)} · ${session.ip}`,
      confirmLabel: session.current ? "Sign out" : "Revoke",
      tone: "danger",
      icon: session.current ? "log-out" : "shield-off",
      onConfirm: async () => {
        setRevoking(session.id);
        try {
          await apiFetch(`/api/v1/sessions/${session.id}`, { method: "DELETE" });
          if (session.current) {
            await signOut();
          } else {
            setSessions((current) => current.filter((item) => item.id !== session.id));
            toast({ title: "Session revoked", tone: "success" });
          }
        } catch (caught) {
          toast({
            title: caught instanceof ApiError ? caught.message : "Session could not be revoked",
            tone: "error",
          });
        } finally {
          setRevoking(null);
        }
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
      <ScreenHeader
        title="Security"
        subtitle="Keys, devices and two-factor"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: insets.bottom + spacing.xxxl,
          gap: spacing.xxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor={palette.accent}
            colors={[palette.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.hero,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View
            style={[
              styles.heroIcon,
              { backgroundColor: keys ? palette.mintSoft : palette.warningSoft },
            ]}
          >
            <Feather
              name={keys ? "shield" : "lock"}
              size={24}
              color={keys ? palette.mint : palette.warning}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="heading" weight="semibold">
              {keys ? "Mailbox is unlocked" : "Mailbox is locked"}
            </AppText>
            <AppText variant="caption" color={palette.muted} style={{ lineHeight: 18 }}>
              {keys
                ? "Your private key is in memory on this device only. It is cleared after 5 minutes in the background."
                : "The decrypted private key is not in memory. Unlock to read mail."}
            </AppText>
          </View>
        </View>

        <Section title="ENCRYPTION">
          <SettingRow
            icon="key"
            title="Public key fingerprint"
            description={fingerprint || "Unavailable"}
            right={<View style={[styles.secureDot, { backgroundColor: palette.mint }]} />}
          />
          <SettingRow
            icon="cpu"
            title="Key derivation"
            description="Argon2id · 64 MiB · 2 iterations"
            right={
              <View style={[styles.statusPill, { backgroundColor: palette.mintSoft }]}>
                <AppText variant="micro" color={palette.mint} style={{ fontSize: 8 }}>
                  Local
                </AppText>
              </View>
            }
          />
          <SettingRow
            icon="lock"
            title="Lock mailbox now"
            description="Clears the decrypted key from memory"
            onPress={lock}
            last
          />
        </Section>

        <Section title="TWO-FACTOR AUTHENTICATION">
          <SettingRow
            icon="smartphone"
            title="Authenticator app"
            description={user?.totpEnabled ? "TOTP is enabled" : "Setup required"}
            right={
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: user?.totpEnabled ? palette.mintSoft : palette.warningSoft },
                ]}
              >
                <AppText
                  variant="micro"
                  color={user?.totpEnabled ? palette.mint : palette.warning}
                  style={{ fontSize: 8 }}
                >
                  {user?.totpEnabled ? "Active" : "Off"}
                </AppText>
              </View>
            }
          />
          <SettingRow
            icon="life-buoy"
            title="Backup codes"
            description={`${user?.backupCodesRemaining ?? 0} unused codes remaining`}
            onPress={() => Linking.openURL(`${baseUrl}/settings`).catch(() => undefined)}
          />
          <SettingRow
            icon="key"
            title="Passkeys"
            description={
              user?.passkeyCount
                ? `${user.passkeyCount} passkey${user.passkeyCount === 1 ? "" : "s"} registered`
                : "No passkeys registered"
            }
            onPress={() => Linking.openURL(`${baseUrl}/settings`).catch(() => undefined)}
          />
          <SettingRow
            icon="key"
            title="Change password"
            description="Re-encrypts your key bundle on this device"
            onPress={() => Linking.openURL(`${baseUrl}/settings`).catch(() => undefined)}
            last
          />
        </Section>

        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText variant="micro" color={palette.faint}>
              ACTIVE SESSIONS
            </AppText>
            {loading ? <ActivityIndicator size="small" color={palette.accent} /> : null}
          </View>
          <View
            style={[
              styles.sessions,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            {error ? (
              <View style={{ padding: spacing.lg, gap: spacing.md }}>
                <AppText variant="caption" color={palette.danger}>
                  {error}
                </AppText>
                <Button
                  label="Retry"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => void load("initial")}
                />
              </View>
            ) : (
              sessions.map((session, index) => (
                <View
                  key={session.id}
                  style={[
                    styles.sessionRow,
                    index < sessions.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: palette.borderSoft,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.sessionIcon,
                      { backgroundColor: session.current ? palette.accentSoft : palette.surfaceRaised },
                    ]}
                  >
                    <Feather
                      name={/android|iphone|ipad|mobile|nyxmail|okhttp/i.test(session.userAgent) ? "smartphone" : "monitor"}
                      size={16}
                      color={session.current ? palette.accent : palette.muted}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <AppText variant="small" weight="medium">
                        {deviceLabel(session.userAgent)}
                      </AppText>
                      {session.current ? (
                        <View style={[styles.currentPill, { backgroundColor: palette.mintSoft }]}>
                          <AppText variant="micro" color={palette.mint} style={{ fontSize: 7.5 }}>
                            This device
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText variant="caption" color={palette.faint}>
                      {browserLabel(session.userAgent)} ·{" "}
                      {session.ip.replace(/^::ffff:/, "")}
                    </AppText>
                    <AppText variant="micro" color={palette.faint} style={{ fontSize: 8 }}>
                      Active {formatRelativeTime(session.lastSeenAt).toLowerCase()}
                    </AppText>
                  </View>
                  {revoking === session.id ? (
                    <ActivityIndicator size="small" color={palette.danger} />
                  ) : (
                    <IconButton
                      name={session.current ? "log-out" : "x-circle"}
                      size={34}
                      iconSize={16}
                      color={palette.danger}
                      accessibilityLabel={session.current ? "Sign out" : "Revoke session"}
                      onPress={() => revoke(session)}
                    />
                  )}
                </View>
              ))
            )}
            {!loading && !error && sessions.length === 0 ? (
              <View style={{ padding: spacing.lg }}>
                <AppText variant="caption" color={palette.faint}>
                  No active sessions found.
                </AppText>
              </View>
            ) : null}
          </View>
        </View>

        <View
          style={[
            styles.warning,
            { backgroundColor: palette.warningSoft, borderColor: "rgba(242,185,92,0.18)" },
          ]}
        >
          <Feather name="alert-triangle" size={15} color={palette.warning} />
          <AppText variant="caption" color={palette.warning} style={{ flex: 1, lineHeight: 18 }}>
            There is no password reset that can decrypt your mailbox. Keep your 24-word recovery kit
            offline and your backup codes somewhere safe.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  secureDot: { width: 8, height: 8, borderRadius: 4 },
  statusPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  sessions: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  sessionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  currentPill: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
});
