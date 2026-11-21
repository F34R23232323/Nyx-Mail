import React from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { LogoMark } from "../../components/ui/Logo";
import { ScreenHeader } from "../../components/ui/EmptyState";
import { Touchable } from "../../components/ui/Touchable";

const features: { icon: keyof typeof Feather.glyphMap; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "Zero-access encryption",
    body: "Subjects, bodies and attachments are sealed with X25519 and XSalsa20-Poly1305. The server stores ciphertext only.",
  },
  {
    icon: "cpu",
    title: "Keys stay on your phone",
    body: "Argon2id derives your key locally. The password and decrypted private key never leave the device.",
  },
  {
    icon: "shield",
    title: "Two factors, always",
    body: "TOTP, one-time backup codes and optional passkeys protect every new session.",
  },
  {
    icon: "eye-off",
    title: "Nothing tracked",
    body: "No analytics, no ad SDKs, no remote fonts. Remote images are blocked until you allow them.",
  },
];

export function AboutScreen({ navigation }: RootScreenProps<"About">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { baseUrl } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
      <ScreenHeader title="About" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: "center", gap: spacing.lg, paddingVertical: spacing.xl }}>
          <LogoMark size={74} />
          <View style={{ alignItems: "center", gap: 3 }}>
            <AppText variant="display" weight="bold">
              Nyx
              <AppText variant="display" weight="bold" color={palette.accentStrong}>
                Mail
              </AppText>
            </AppText>
            <AppText variant="caption" color={palette.muted}>
              Mobile · version 1.1.1 (build 3)
            </AppText>
            <View
              style={[
                styles.badge,
                { backgroundColor: palette.mintSoft, borderColor: "rgba(63,224,197,0.2)" },
              ]}
            >
              <Feather name="shield" size={10} color={palette.mint} />
              <AppText variant="micro" color={palette.mint} style={{ fontSize: 8 }}>
                Zero-access encrypted mail
              </AppText>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          {features.map((feature, index) => (
            <View
              key={feature.title}
              style={[
                styles.feature,
                index < features.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.borderSoft,
                },
              ]}
            >
              <View style={[styles.featureIcon, { backgroundColor: palette.accentSoft }]}>
                <Feather name={feature.icon} size={16} color={palette.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="small" weight="semibold">
                  {feature.title}
                </AppText>
                <AppText variant="caption" color={palette.muted} style={{ lineHeight: 18 }}>
                  {feature.body}
                </AppText>
              </View>
            </View>
          ))}
        </View>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="micro" color={palette.faint}>
            CONNECTED SERVER
          </AppText>
          <Touchable
            onPress={() => Linking.openURL(baseUrl).catch(() => undefined)}
            haptic="light"
            style={[
              styles.server,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <View style={[styles.featureIcon, { backgroundColor: palette.mintSoft }]}>
              <Feather name="globe" size={16} color={palette.mint} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" weight="medium">
                {baseUrl.replace(/^https?:\/\//, "")}
              </AppText>
              <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                Tap to open the web app
              </AppText>
            </View>
            <Feather name="external-link" size={14} color={palette.faint} />
          </Touchable>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={[styles.feature, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.borderSoft }]}>
            <View style={[styles.featureIcon, { backgroundColor: palette.surfaceRaised }]}>
              <Feather name="code" size={16} color={palette.muted} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="small" weight="semibold">
                Open cryptography
              </AppText>
              <AppText variant="caption" color={palette.muted} style={{ lineHeight: 18 }}>
                TweetNaCl, Noble Argon2id, BLAKE2b and XChaCha20. Wire formats are byte-compatible
                with libsodium and the NyxMail web app.
              </AppText>
            </View>
          </View>
          <View style={styles.feature}>
            <View style={[styles.featureIcon, { backgroundColor: palette.surfaceRaised }]}>
              <Feather name="heart" size={16} color={palette.pink} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="small" weight="semibold">
                Built with React Native
              </AppText>
              <AppText variant="caption" color={palette.muted} style={{ lineHeight: 18 }}>
                One hundred percent native mobile components. No WebView, no embedded browser.
              </AppText>
            </View>
          </View>
        </View>

        <AppText variant="caption" color={palette.faint} align="center" style={{ lineHeight: 19 }}>
          NyxMail is self-hosted software. You own the server, the keys and the mail.
          {"\n"}Password recovery requires your 24-word kit — not an administrator.
        </AppText>
        <AppText variant="micro" color={palette.faint} align="center" style={{ fontSize: 8 }}>
          MIT licensed · © {new Date().getFullYear()} NyxMail
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  feature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  server: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
