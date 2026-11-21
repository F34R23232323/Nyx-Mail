import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette, useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useMailData } from "../../lib/mail-data";
import { formatBytes, displaySender } from "../../lib/format";
import type { TabScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Section, SettingRow, Toggle } from "../../components/ui/Section";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { Touchable } from "../../components/ui/Touchable";

export function SettingsScreen({ navigation }: TabScreenProps<"Settings">) {
  const palette = usePalette();
  const { mode, toggle } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, baseUrl, signOut, lock } = useAuth();
  const { folders, labels, aliases, gmailAccounts, unread } = useMailData();
  const confirm = useConfirm();

  const used = user?.storageUsedBytes ?? 0;
  const limit = user?.storageLimitBytes ?? 1;
  const percent = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  const confirmSignOut = () => {
    void confirm({
      title: "Sign out of NyxMail?",
      description: "Your encrypted keys will be removed from memory. You can unlock again with your password.",
      confirmLabel: "Sign out",
      tone: "danger",
      icon: "log-out",
      onConfirm: () => signOut(),
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: palette.canvas,
          zIndex: 20,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + 130,
          paddingHorizontal: spacing.xl,
          gap: spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: spacing.xs }}>
          <AppText variant="display" weight="bold">
            Settings
          </AppText>
          <AppText variant="caption" color={palette.muted}>
            Your account, security and devices
          </AppText>
        </View>

        <Touchable
          onPress={() => navigation.navigate("Account")}
          haptic="light"
          style={[
            styles.profileCard,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={styles.profileTop}>
            <Avatar name={user?.displayName} email={user?.email} size={54} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="heading" weight="semibold" numberOfLines={1}>
                {user ? displaySender(user.displayName, user.email) : "Account"}
              </AppText>
              <AppText variant="caption" color={palette.muted} numberOfLines={1}>
                {user?.email}
              </AppText>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                <Feather name="shield" size={10} color={palette.mint} />
                <AppText variant="micro" color={palette.mint} style={{ fontSize: 8 }}>
                  Keys protected by your password
                </AppText>
              </View>
            </View>
            <Feather name="chevron-right" size={17} color={palette.faint} />
          </View>
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                Secure storage
              </AppText>
              <AppText variant="micro" color={palette.muted} style={{ fontSize: 8.5 }}>
                {formatBytes(used)} of {formatBytes(limit)}
              </AppText>
            </View>
            <View style={[styles.track, { backgroundColor: palette.surfaceRaised }]}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${Math.max(2, percent)}%`,
                    backgroundColor: percent > 90 ? palette.danger : palette.accent,
                  },
                ]}
              />
            </View>
          </View>
        </Touchable>

        <Section title="MAILBOX">
          <SettingRow
            icon="inbox"
            title="Folders"
            description={`${folders.length} folders`}
            onPress={() => navigation.navigate("Folders")}
          />
          <SettingRow
            icon="tag"
            title="Labels"
            description={`${labels.length} labels`}
            onPress={() => navigation.navigate("Labels")}
          />
          <SettingRow
            icon="at-sign"
            title="Aliases"
            description={`${aliases.length} additional addresses`}
            onPress={() => navigation.navigate("Aliases")}
          />
          <SettingRow
            icon="mail"
            title="Gmail sending"
            description={
              gmailAccounts.length
                ? `${gmailAccounts.length} connected Gmail identit${gmailAccounts.length === 1 ? "y" : "ies"}`
                : "Connect Gmail to send from that address"
            }
            tone={gmailAccounts.length ? "accent" : "default"}
            onPress={() => navigation.navigate("Aliases")}
          />
          <SettingRow
            icon="edit-3"
            title="Signature & profile"
            value={user?.displayName}
            onPress={() => navigation.navigate("Account")}
            last
          />
        </Section>

        <Section title="SECURITY">
          <SettingRow
            icon="shield"
            title="Encryption & sessions"
            description="Devices, keys and two-factor"
            onPress={() => navigation.navigate("Security")}
            tone="accent"
          />
          <SettingRow
            icon="lock"
            title="Lock mailbox now"
            description="Clears the decrypted key from memory"
            onPress={lock}
          />
          <SettingRow
            icon="mail"
            title="Unread messages"
            value={unread > 0 ? String(unread) : "All read"}
            right={
              <View style={[styles.statusPill, { backgroundColor: unread > 0 ? palette.accentSoft : palette.mintSoft }]}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: unread > 0 ? palette.accent : palette.mint },
                  ]}
                />
                <AppText
                  variant="micro"
                  color={unread > 0 ? palette.accentStrong : palette.mint}
                  style={{ fontSize: 8 }}
                >
                  {unread > 0 ? "Synced" : "Inbox zero"}
                </AppText>
              </View>
            }
            last
          />
        </Section>

        <Section title="APPEARANCE">
          <SettingRow
            icon={mode === "dark" ? "moon" : "sun"}
            title="Dark appearance"
            description={mode === "dark" ? "Onyx theme is on" : "Daylight theme is on"}
            right={<Toggle value={mode === "dark"} onChange={toggle} label="Dark appearance" />}
          />
          <SettingRow
            icon="sliders"
            title="Theme & display"
            description="Preview both themes"
            onPress={() => navigation.navigate("Appearance")}
            last
          />
        </Section>

        <Section title="APP">
          <SettingRow
            icon="globe"
            title="Mail server"
            description={baseUrl.replace(/^https?:\/\//, "")}
          />
          <SettingRow
            icon="info"
            title="About NyxMail"
            description="Version 1.1.1 · Mobile"
            onPress={() => navigation.navigate("About")}
            last
          />
        </Section>

        <Button label="Sign out" variant="danger" icon="log-out" onPress={confirmSignOut} />
        <AppText variant="micro" color={palette.faint} align="center" style={{ fontSize: 8.5 }}>
          NyxMail Mobile · zero-access encrypted mail
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  profileTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  track: { height: 5, borderRadius: 3, overflow: "hidden" },
  bar: { height: 5, borderRadius: 3 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  statusDot: { width: 4, height: 4, borderRadius: 2 },
});
