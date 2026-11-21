import React, { useEffect, useState } from "react";
import { ActivityIndicator, TextInput, ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useMailData } from "../../lib/mail-data";
import { apiFetch, ApiError } from "../../lib/api";
import { connectGmailForSending } from "../../lib/gmail";
import { isEmail } from "../../lib/format";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { EmptyState, ScreenHeader } from "../../components/ui/EmptyState";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { IconButton } from "../../components/ui/IconButton";
import { Sheet } from "../../components/ui/Sheet";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";

export function AliasesScreen({ navigation }: RootScreenProps<"Aliases">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { aliases, gmailAccounts, refreshAliases, refreshGmailAccounts } = useMailData();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [localPart, setLocalPart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);

  useEffect(() => {
    void refreshGmailAccounts().catch(() => undefined);
  }, [refreshGmailAccounts]);

  const domain = user?.email.split("@")[1] ?? "";

  const create = async () => {
    const local = localPart.trim().toLowerCase().replace(/[^a-z0-9._+-]/g, "");
    if (!local) return setError("Enter the part before @.");
    const address = `${local}@${domain}`;
    if (!isEmail(address)) return setError("Enter a valid alias.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/aliases", {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      await refreshAliases();
      setOpen(false);
      setLocalPart("");
      toast({ title: "Alias created", description: address, tone: "success" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Alias could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const connectGmail = async () => {
    if (gmailBusy) return;
    setGmailBusy(true);
    try {
      const result = await connectGmailForSending();
      if (!result) return;
      await refreshGmailAccounts();
      toast({
        title: "Gmail connected",
        description: `${result.email ?? "Google account"} can now send as a Gmail identity.`,
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "Gmail connection failed",
        description:
          caught instanceof ApiError || caught instanceof Error ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setGmailBusy(false);
    }
  };

  const remove = (id: string, address: string) => {
    void confirm({
      title: "Delete alias?",
      description: `${address} will stop receiving new mail. Existing messages are kept.`,
      confirmLabel: "Delete alias",
      tone: "warning",
      icon: "at-sign",
      details: [{ label: "Address", value: address }],
      onConfirm: async () => {
        try {
          await apiFetch(`/api/v1/aliases/${id}`, { method: "DELETE" });
          await refreshAliases();
          toast({ title: "Alias deleted", tone: "default" });
        } catch (caught) {
          toast({
            title: caught instanceof ApiError ? caught.message : "Alias could not be deleted",
            tone: "error",
          });
        }
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
      <ScreenHeader
        title="Aliases"
        subtitle="Extra addresses that land in this mailbox"
        onBack={() => navigation.goBack()}
        right={
          <IconButton
            name="plus"
            variant="soft"
            size={38}
            accessibilityLabel="Create alias"
            onPress={() => {
              setLocalPart("");
              setError(null);
              setOpen(true);
            }}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: spacing.sm }}>
          <AppText variant="micro" color={palette.faint}>
            SEND & RECEIVE FROM
          </AppText>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.row}>
              <Avatar name={user?.displayName} email={user?.email} size={40} />
              <View style={{ flex: 1, gap: 1 }}>
                <AppText variant="small" weight="semibold" numberOfLines={1}>
                  {user?.email}
                </AppText>
                <AppText variant="caption" color={palette.faint}>
                  Primary address
                </AppText>
              </View>
              <View style={[styles.primaryPill, { backgroundColor: palette.accentSoft }]}>
                <AppText variant="micro" color={palette.accentStrong} style={{ fontSize: 8 }}>
                  Primary
                </AppText>
              </View>
            </View>
            {aliases.length === 0 ? (
              <EmptyState
                compact
                icon="at-sign"
                title="No aliases yet"
                description="Create an alias to use a different address without a second mailbox."
                actionLabel="Create alias"
                onAction={() => setOpen(true)}
              />
            ) : (
              aliases.map((alias, index) => (
                <View
                  key={alias.id}
                  style={[
                    styles.row,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: palette.borderSoft,
                    },
                  ]}
                >
                  <Avatar name={undefined} email={alias.address} size={40} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <AppText variant="small" weight="semibold" numberOfLines={1}>
                      {alias.address}
                    </AppText>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: alias.active ? palette.mint : palette.faint },
                        ]}
                      />
                      <AppText variant="caption" color={palette.faint}>
                        {alias.active ? "Active alias" : "Inactive"}
                      </AppText>
                    </View>
                  </View>
                  <IconButton
                    name="trash-2"
                    size={34}
                    iconSize={15}
                    color={palette.danger}
                    accessibilityLabel={`Delete ${alias.address}`}
                    onPress={() => remove(alias.id, alias.address)}
                  />
                </View>
              ))
            )}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="micro" color={palette.faint}>
            GMAIL SENDING
          </AppText>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {gmailAccounts.length === 0 ? (
              <View style={{ padding: spacing.lg, gap: spacing.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={[styles.gmailIcon, { backgroundColor: palette.pinkSoft }]}>
                    <Feather name="mail" size={17} color={palette.pink} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="small" weight="semibold">
                      Send from a Gmail address
                    </AppText>
                    <AppText variant="caption" color={palette.muted} style={{ lineHeight: 18 }}>
                      Connect a Google account to use its address in the From menu.
                    </AppText>
                  </View>
                </View>
                <Button
                  label={gmailBusy ? "Opening Google…" : "Connect Gmail"}
                  icon="external-link"
                  variant="secondary"
                  loading={gmailBusy}
                  onPress={connectGmail}
                />
              </View>
            ) : (
              <>
                {gmailAccounts.map((account, index) => (
                  <View
                    key={account.id}
                    style={[
                      styles.gmailRow,
                      index < gmailAccounts.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: palette.borderSoft,
                      },
                    ]}
                  >
                    <View style={[styles.gmailIcon, { backgroundColor: palette.pinkSoft }]}>
                      <Feather name="mail" size={17} color={palette.pink} />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <AppText variant="small" weight="semibold" numberOfLines={1}>
                        {account.googleEmail}
                      </AppText>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: account.enabled ? palette.mint : palette.faint },
                          ]}
                        />
                        <AppText variant="caption" color={palette.faint}>
                          {account.enabled ? "Connected · send permission ready" : "Disabled"}
                        </AppText>
                      </View>
                    </View>
                    <Touchable
                      onPress={connectGmail}
                      disabled={gmailBusy}
                      haptic="light"
                      style={[styles.reconnect, { borderColor: palette.border }]}
                    >
                      {gmailBusy ? (
                        <ActivityIndicator size="small" color={palette.accent} />
                      ) : (
                        <AppText variant="micro" color={palette.accentStrong} style={{ fontSize: 8.5 }}>
                          REAUTHORIZE
                        </AppText>
                      )}
                    </Touchable>
                  </View>
                ))}
                <Touchable
                  onPress={connectGmail}
                  disabled={gmailBusy}
                  haptic="light"
                  style={[styles.addGmail, { borderTopColor: palette.borderSoft }]}
                >
                  <Feather name="plus" size={14} color={palette.accent} />
                  <AppText variant="caption" weight="medium" color={palette.accentStrong}>
                    Connect another Gmail account
                  </AppText>
                </Touchable>
              </>
            )}
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <Feather name="alert-triangle" size={12} color={palette.warning} style={{ marginTop: 2 }} />
            <AppText variant="caption" color={palette.faint} style={{ flex: 1, lineHeight: 18 }}>
              Messages sent through Gmail are delivered by Google and leave end-to-end encryption for
              external recipients. Your encrypted NyxMail Sent copy stays protected.
            </AppText>
          </View>
        </View>

        <View
          style={[
            styles.note,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Feather name="send" size={14} color={palette.accent} />
            <AppText variant="caption" weight="semibold">
              Sending from an alias
            </AppText>
          </View>
          <AppText variant="caption" color={palette.muted} style={{ lineHeight: 19 }}>
            Open the composer and tap <AppText variant="caption" weight="semibold">From</AppText> to
            choose any active alias. Replies continue to arrive in this same encrypted mailbox.
          </AppText>
          <View style={[styles.divider, { backgroundColor: palette.borderSoft }]} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Feather name="info" size={13} color={palette.faint} />
            <AppText variant="caption" color={palette.faint} style={{ flex: 1 }}>
              Up to 10 aliases per account. Aliases must use one of the domains hosted by your
              NyxMail server.
            </AppText>
          </View>
        </View>
      </ScrollView>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="New alias"
        description="Mail to this address lands in your encrypted inbox."
      >
        <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
          <View
            style={[
              styles.aliasPreview,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <TextInputAlias
              value={localPart}
              onChange={(value) => {
                setLocalPart(value);
                setError(null);
              }}
              domain={domain}
            />
          </View>
          {error ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: palette.dangerSoft, borderColor: "rgba(255,113,133,0.22)" },
              ]}
            >
              <Feather name="alert-circle" size={14} color={palette.danger} />
              <AppText variant="caption" color={palette.danger} style={{ flex: 1 }}>
                {error}
              </AppText>
            </View>
          ) : null}
          <Button label="Create alias" icon="plus" size="lg" loading={busy} onPress={create} />
        </View>
      </Sheet>
    </View>
  );
}

function TextInputAlias({
  value,
  onChange,
  domain,
}: {
  value: string;
  onChange: (value: string) => void;
  domain: string;
}) {
  const palette = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <Feather name="at-sign" size={15} color={focused ? palette.accent : palette.faint} />
      <View style={{ flex: 1 }}>
        <TextInput
          value={value}
          onChangeText={(next) => onChange(next.toLowerCase().replace(/[^a-z0-9._+-]/g, ""))}
          placeholder="hello"
          placeholderTextColor={palette.faint}
          selectionColor={palette.accent}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            color: palette.ink,
            fontFamily: "Inter_500Medium",
            fontSize: 16,
            paddingVertical: spacing.md,
          }}
        />
      </View>
      <AppText variant="small" color={palette.muted}>
        @{domain}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 62,
  },
  primaryPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  note: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  divider: { height: StyleSheet.hairlineWidth },
  aliasPreview: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  errorBox: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  gmailIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  gmailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 66,
  },
  reconnect: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addGmail: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
