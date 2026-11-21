import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette, useTheme } from "../../theme/ThemeProvider";
import { palettes, radius, spacing } from "../../theme/tokens";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { ScreenHeader } from "../../components/ui/EmptyState";
import { Section } from "../../components/ui/Section";
import { Touchable } from "../../components/ui/Touchable";

function ThemePreview({ mode }: { mode: "dark" | "light" }) {
  const palette = palettes[mode];
  const selected = useTheme().mode === mode;
  const active = useTheme();
  return (
    <Touchable
      onPress={() => active.setMode(mode)}
      haptic="medium"
      accessibilityLabel={`Use ${mode} theme`}
      style={[
        styles.previewCard,
        {
          backgroundColor: palette.canvas,
          borderColor: selected ? active.palette.accent : active.palette.border,
          borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.previewHeader, { backgroundColor: palette.canvasRaised }]}>
        <View style={[styles.previewLogo, { backgroundColor: palette.accent }]} />
        <View style={{ gap: 4, flex: 1 }}>
          <View style={[styles.previewLine, { backgroundColor: palette.ink, width: "44%" }]} />
          <View style={[styles.previewLine, { backgroundColor: palette.faint, width: "30%", height: 3 }]} />
        </View>
        <View style={[styles.previewDot, { backgroundColor: palette.mint }]} />
      </View>
      <View style={{ padding: spacing.md, gap: 7 }}>
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            style={[styles.previewRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <View style={[styles.previewAvatar, { backgroundColor: palette.avatarGradients[index][0] }]} />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={[styles.previewLine, { backgroundColor: palette.inkSoft, width: "52%" }]} />
              <View style={[styles.previewLine, { backgroundColor: palette.faint, width: "78%", height: 3 }]} />
            </View>
            {index === 0 ? (
              <View style={[styles.previewBadge, { backgroundColor: palette.accentSoft }]} />
            ) : null}
          </View>
        ))}
      </View>
      <View style={styles.previewFooter}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Feather
            name={mode === "dark" ? "moon" : "sun"}
            size={13}
            color={selected ? active.palette.accent : palette.muted}
          />
          <AppText
            variant="caption"
            weight={selected ? "semibold" : "medium"}
            color={selected ? active.palette.accentStrong : palette.muted}
          >
            {mode === "dark" ? "Onyx" : "Daylight"}
          </AppText>
        </View>
        {selected ? (
          <View style={[styles.check, { backgroundColor: active.palette.accent }]}>
            <Feather name="check" size={11} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    </Touchable>
  );
}

export function AppearanceScreen({ navigation }: RootScreenProps<"Appearance">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { mode } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
      <ScreenHeader
        title="Theme"
        subtitle="Designed for late nights and bright mornings"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: insets.bottom + spacing.xxxl,
          gap: spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: spacing.md }}>
          <AppText variant="micro" color={palette.faint}>
            APPEARANCE
          </AppText>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <ThemePreview mode="dark" />
            <ThemePreview mode="light" />
          </View>
          <AppText variant="caption" color={palette.faint} style={{ lineHeight: 18 }}>
            Your choice is saved on this device. Both themes use the same contrast-safe palette for
            reading encrypted mail.
          </AppText>
        </View>

        <Section title="READING">
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={[styles.icon, { backgroundColor: palette.accentSoft }]}>
                <Feather name="type" size={16} color={palette.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="small" weight="medium">
                  System text scaling
                </AppText>
                <AppText variant="caption" color={palette.faint}>
                  NyxMail follows your Android font-size setting.
                </AppText>
              </View>
              <Feather name="check-circle" size={16} color={palette.mint} />
            </View>
            <View style={[styles.divider, { backgroundColor: palette.borderSoft }]} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={[styles.icon, { backgroundColor: palette.mintSoft }]}>
                <Feather name="image" size={16} color={palette.mint} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="small" weight="medium">
                  Remote images blocked
                </AppText>
                <AppText variant="caption" color={palette.faint}>
                  Load them per message when you trust the sender.
                </AppText>
              </View>
              <Feather name="check-circle" size={16} color={palette.mint} />
            </View>
          </View>
        </Section>

        <View
          style={[
            styles.note,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Feather name="shield" size={14} color={palette.mint} />
            <AppText variant="caption" weight="semibold">
              Privacy by default
            </AppText>
          </View>
          <AppText variant="caption" color={palette.muted} style={{ lineHeight: 19 }}>
            Dark mode is the default in NyxMail mobile. Switching themes never affects encryption,
            key storage or how your mail is decrypted.
          </AppText>
          <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
            Currently using {mode === "dark" ? "Onyx" : "Daylight"}
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  previewCard: {
    flex: 1,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  previewLogo: { width: 20, height: 20, borderRadius: 6 },
  previewLine: { height: 5, borderRadius: 3 },
  previewDot: { width: 6, height: 6, borderRadius: 3 },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewAvatar: { width: 18, height: 18, borderRadius: 9 },
  previewBadge: { width: 14, height: 14, borderRadius: 7 },
  previewFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { height: StyleSheet.hairlineWidth },
  note: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
