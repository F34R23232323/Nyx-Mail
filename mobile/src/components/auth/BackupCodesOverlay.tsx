import React from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useToast } from "../ui/Toast";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { LogoMark } from "../ui/Logo";
import { Touchable } from "../ui/Touchable";

export function BackupCodesOverlay() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { backupCodes, clearBackupCodes } = useAuth();
  const { toast } = useToast();

  if (!backupCodes) return null;

  const copy = async () => {
    await Clipboard.setStringAsync(backupCodes.join("\n"));
    toast({ title: "Backup codes copied", tone: "success" });
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={clearBackupCodes}>
      <View style={[styles.backdrop, { backgroundColor: palette.canvas }]}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + spacing.xxl,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.xl,
            gap: spacing.xxl,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: "center", gap: spacing.lg }}>
            <LogoMark size={56} />
            <View style={[styles.successRing, { backgroundColor: palette.mintSoft }]}>
              <Feather name="check" size={22} color={palette.mint} />
            </View>
            <View style={{ alignItems: "center", gap: spacing.sm }}>
              <AppText variant="display" align="center">
                Save your backup codes
              </AppText>
              <AppText variant="small" color={palette.muted} align="center" style={{ maxWidth: 320 }}>
                Each code signs you in once if you lose your authenticator. They are shown only now.
              </AppText>
            </View>
          </View>

          <View
            style={[
              styles.codes,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            {backupCodes.map((code, index) => (
              <View key={code} style={styles.codeCell}>
                <AppText variant="caption" color={palette.faint} style={{ width: 22 }}>
                  {String(index + 1).padStart(2, "0")}
                </AppText>
                <AppText variant="body" weight="semibold" style={{ letterSpacing: 1.4 }}>
                  {code}
                </AppText>
              </View>
            ))}
          </View>

          <Touchable
            onPress={copy}
            haptic="light"
            style={[styles.copyRow, { borderColor: palette.border, backgroundColor: palette.surface }]}
          >
            <Feather name="copy" size={15} color={palette.accent} />
            <AppText variant="small" weight="medium" color={palette.accentStrong}>
              Copy all codes
            </AppText>
          </Touchable>

          <View
            style={[
              styles.warning,
              { backgroundColor: palette.warningSoft, borderColor: "transparent" },
            ]}
          >
            <Feather name="shield" size={17} color={palette.warning} />
            <AppText variant="caption" color={palette.warning} style={{ flex: 1, lineHeight: 18 }}>
              Store them offline. NyxMail cannot recover your mailbox without your password or 24-word
              recovery kit.
            </AppText>
          </View>

          <Button label="I saved my codes" icon="check" size="lg" onPress={clearBackupCodes} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  successRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -4,
  },
  codes: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  codeCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  copyRow: {
    height: 46,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  warning: {
    flexDirection: "row",
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "flex-start",
  },
});
