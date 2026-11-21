import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  Platform,
  RefreshControl,
  StyleSheet,
  UIManager,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Sharing from "expo-sharing";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useMailData } from "../../lib/mail-data";
import { useCompose } from "../../compose/ComposeProvider";
import { apiFetch, ApiError } from "../../lib/api";
import { decryptMail, saveAttachmentToCache } from "../../lib/mail";
import { emitMailEvent } from "../../lib/mailBus";
import {
  displaySender,
  formatBytes,
  formatFullDate,
  formatRelativeTime,
  htmlToText,
  truncate,
} from "../../lib/format";
import type { ClientAttachmentMeta, DecryptedMail, EncryptedMessageDTO, LabelDTO } from "../../lib/types";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";

import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { Sheet, ActionSheet } from "../../components/ui/Sheet";
import { Badge } from "../../components/ui/Chip";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { Skeleton } from "../../components/ui/Skeleton";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";
import { EmailBody } from "../../components/mail/EmailBody";

interface ThreadResponse {
  thread: { id: string; lastActivityAt: string; messageCount: number };
  messages: EncryptedMessageDTO[];
}

export function ThreadScreen({ route, navigation }: RootScreenProps<"Thread">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user, keys } = useAuth();
  const { labels, folders, refreshFolders, refreshUnread } = useMailData();
  const { open: openCompose } = useCompose();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { id } = route.params;

  const [mails, setMails] = useState<DecryptedMail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const ownAddresses = useMemo(
    () => new Set([user?.email.toLowerCase() ?? ""]),
    [user?.email],
  );

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!keys) return;
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const data = await apiFetch<ThreadResponse>(`/api/v1/threads/${encodeURIComponent(id)}`);
        const decrypted = await Promise.all(
          data.messages.map((message) => decryptMail(message, keys)),
        );
        setMails(decrypted);
        setExpanded((current) => {
          if (current.size > 0) return current;
          const last = decrypted[decrypted.length - 1];
          return last ? new Set([last.dto.id]) : new Set();
        });
        if (data.messages.some((message) => !message.isRead && !message.isDraft)) {
          apiFetch(`/api/v1/threads/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "read" }),
          })
            .then(() => {
              emitMailEvent({ type: "thread-updated", threadId: id, action: "read" });
              refreshUnread().catch(() => undefined);
              refreshFolders().catch(() => undefined);
            })
            .catch(() => undefined);
        }
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "This conversation could not be loaded.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, keys, refreshFolders, refreshUnread],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const latest = mails[mails.length - 1];
  const subject = route.params.subject || latest?.subject || "Conversation";
  const participants = useMemo(() => {
    const map = new Map<string, { name: string | null; email: string }>();
    for (const mail of mails) {
      map.set(mail.dto.fromAddress.toLowerCase(), {
        name: mail.dto.fromName,
        email: mail.dto.fromAddress,
      });
    }
    return Array.from(map.values());
  }, [mails]);

  const replySource = useMemo(() => {
    const inbound = [...mails].reverse().find((mail) => !ownAddresses.has(mail.dto.fromAddress.toLowerCase()));
    return inbound ?? latest;
  }, [latest, mails, ownAddresses]);

  const threadLabels = useMemo(() => {
    const map = new Map<string, LabelDTO>();
    for (const mail of mails) for (const label of mail.dto.labels) map.set(label.id, label);
    return Array.from(map.values());
  }, [mails]);

  const action = useCallback(
    async (name: string, extra?: Record<string, unknown>, leave = true) => {
      if (busyAction) return;
      setBusyAction(true);
      try {
        await apiFetch(`/api/v1/threads/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ action: name, ...extra }),
        });
        emitMailEvent({ type: "thread-updated", threadId: id, action: name });
        refreshUnread().catch(() => undefined);
        refreshFolders().catch(() => undefined);
        if (leave) navigation.goBack();
      } catch (caught) {
        toast({
          title: caught instanceof ApiError ? caught.message : "Action failed",
          tone: "error",
        });
      } finally {
        setBusyAction(false);
      }
    },
    [busyAction, id, navigation, refreshFolders, refreshUnread, toast],
  );

  const toggleLabel = async (label: LabelDTO) => {
    const has = threadLabels.some((item) => item.id === label.id);
    setMails((current) =>
      current.map((mail) => ({
        ...mail,
        dto: {
          ...mail.dto,
          labels: has
            ? mail.dto.labels.filter((item) => item.id !== label.id)
            : [...mail.dto.labels, label],
        },
      })),
    );
    try {
      await apiFetch(`/api/v1/threads/${encodeURIComponent(id)}/labels`, {
        method: "POST",
        body: JSON.stringify({ labelId: label.id, add: !has }),
      });
      emitMailEvent({ type: "mail-changed" });
    } catch {
      toast({ title: "Label could not be updated", tone: "error" });
      void load("refresh");
    }
  };

  const downloadAttachment = async (attachment: ClientAttachmentMeta) => {
    if (downloading) return;
    setDownloading(attachment.blobId);
    try {
      const file = await saveAttachmentToCache(attachment, attachment.key);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: file.mimeType,
          dialogTitle: file.filename,
        });
      } else {
        toast({ title: "Attachment saved", description: file.uri, tone: "success" });
      }
    } catch (caught) {
      toast({
        title: "Attachment could not be opened",
        description: caught instanceof Error ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setDownloading(null);
    }
  };

  const toggleExpanded = (messageId: string) => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const requestDelete = () => {
    void confirm({
      title: "Delete this conversation?",
      description:
        "It moves to Trash and stays recoverable for 30 days. You can undo right after deleting.",
      confirmLabel: "Move to trash",
      tone: "warning",
      icon: "trash-2",
      details: [{ label: "Subject", value: subject }],
      onConfirm: async () => {
        await action("trash");
        toast({
          title: "Moved to trash",
          description: "Restore it from Trash within 30 days.",
          tone: "default",
          action: {
            label: "Undo",
            onPress: async () => {
              try {
                await apiFetch(`/api/v1/threads/${encodeURIComponent(id)}`, {
                  method: "PATCH",
                  body: JSON.stringify({ action: "inbox" }),
                });
                emitMailEvent({ type: "thread-updated", threadId: id, action: "inbox" });
                refreshUnread().catch(() => undefined);
                refreshFolders().catch(() => undefined);
                toast({ title: "Conversation restored", tone: "success" });
              } catch {
                toast({ title: "Could not restore the conversation", tone: "error" });
              }
            },
          },
        });
      },
    });
  };

  const header = (
    <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
        <View
          style={[
            styles.encryptedPill,
            { backgroundColor: palette.mintSoft, borderColor: "rgba(63,224,197,0.2)" },
          ]}
        >
          <Feather name="lock" size={9} color={palette.mint} />
          <AppText variant="micro" color={palette.mint} style={{ fontSize: 8 }}>
            End-to-end encrypted
          </AppText>
        </View>
        {threadLabels.map((label) => (
          <View
            key={label.id}
            style={[styles.labelPill, { backgroundColor: `${label.color}22`, borderColor: `${label.color}55` }]}
          >
            <View style={[styles.labelDot, { backgroundColor: label.color }]} />
            <AppText variant="micro" color={label.color} style={{ fontSize: 8.5 }}>
              {label.name}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="display" weight="bold" style={{ lineHeight: 34 }}>
        {subject}
      </AppText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flexDirection: "row" }}>
          {participants.slice(0, 4).map((participant, index) => (
            <View
              key={participant.email}
              style={{
                marginLeft: index === 0 ? 0 : -8,
                borderWidth: 2,
                borderColor: palette.canvas,
                borderRadius: 16,
              }}
            >
              <Avatar name={participant.name} email={participant.email} size={26} />
            </View>
          ))}
        </View>
        <AppText variant="caption" color={palette.faint} style={{ flex: 1 }}>
          {mails.length} message{mails.length === 1 ? "" : "s"} · {participants.length} participant
          {participants.length === 1 ? "" : "s"}
        </AppText>
      </View>
      <View style={[styles.threadDivider, { backgroundColor: palette.borderSoft }]} />
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
        <View style={styles.topBar}>
          <IconButton name="arrow-left" onPress={() => navigation.goBack()} accessibilityLabel="Back" />
          <View style={{ flex: 1 }} />
          <IconButton name="more-horizontal" accessibilityLabel="More" />
        </View>
        <View style={{ padding: spacing.xl, gap: spacing.lg }}>
          <Skeleton width="72%" height={30} />
          <Skeleton width="42%" height={12} />
          <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
            {[0, 1, 2].map((index) => (
              <View
                key={index}
                style={[
                  styles.skeletonCard,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                  <Skeleton width={40} height={40} radiusSize={20} />
                  <View style={{ gap: 6, flex: 1 }}>
                    <Skeleton width="46%" height={11} />
                    <Skeleton width="30%" height={9} />
                  </View>
                </View>
                <Skeleton width="100%" height={10} />
                <Skeleton width="88%" height={10} />
                <Skeleton width="64%" height={10} />
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (error && mails.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
        <View style={styles.topBar}>
          <IconButton name="arrow-left" onPress={() => navigation.goBack()} accessibilityLabel="Back" />
        </View>
        <ErrorState message={error} onRetry={() => void load("initial")} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <LinearGradient
        colors={["rgba(138,120,255,0.10)", "rgba(8,9,13,0)"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 220 }}
        pointerEvents="none"
      />
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton
          name="arrow-left"
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to inbox"
          size={38}
        />
        <View style={{ flex: 1 }}>
          <AppText variant="caption" color={palette.muted} numberOfLines={1}>
            {latest?.dto.folderType
              ? latest.dto.folderType.charAt(0) + latest.dto.folderType.slice(1).toLowerCase()
              : "Conversation"}
          </AppText>
        </View>
        <IconButton
          name="star"
          size={38}
          color={latest?.dto.isStarred ? palette.star : palette.inkSoft}
          accessibilityLabel={latest?.dto.isStarred ? "Unstar conversation" : "Star conversation"}
          onPress={() => {
            const starred = latest?.dto.isStarred;
            setMails((current) =>
              current.map((mail) => ({
                ...mail,
                dto: { ...mail.dto, isStarred: !starred },
              })),
            );
            void action(starred ? "unstar" : "star", undefined, false);
          }}
        />
        <IconButton
          name="more-horizontal"
          size={38}
          accessibilityLabel="Conversation actions"
          onPress={() => setMenuOpen(true)}
        />
      </View>

      <FlatList
        data={mails}
        keyExtractor={(item) => item.dto.id}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => {
          const isExpanded = expanded.has(item.dto.id);
          const isOwn = ownAddresses.has(item.dto.fromAddress.toLowerCase());
          const snippet =
            item.body.text || htmlToText(item.body.html) || "No preview available.";
          return (
            <View
              style={[
                styles.messageCard,
                {
                  backgroundColor: isExpanded ? palette.surface : "transparent",
                  borderColor: isExpanded ? palette.border : palette.borderSoft,
                },
              ]}
            >
              <Touchable
                onPress={() => toggleExpanded(item.dto.id)}
                haptic="none"
                style={styles.messageHeader}
              >
                <Avatar
                  name={item.dto.fromName}
                  email={item.dto.fromAddress}
                  size={38}
                />
                <View style={{ flex: 1, gap: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <AppText variant="small" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                      {isOwn ? "You" : displaySender(item.dto.fromName, item.dto.fromAddress)}
                    </AppText>
                    <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                      {formatRelativeTime(item.dto.sentAt)}
                    </AppText>
                  </View>
                  <AppText variant="caption" color={palette.faint} numberOfLines={1}>
                    {isOwn ? `to ${item.dto.toAddresses.map((a) => a.email).join(", ")}` : item.dto.fromAddress}
                  </AppText>
                </View>
                <Feather
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={palette.faint}
                />
              </Touchable>

              {isExpanded ? (
                <View style={styles.messageBody}>
                  <View style={styles.detailsRow}>
                    <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                      {formatFullDate(item.dto.sentAt)}
                    </AppText>
                    {item.dto.toAddresses.length > 0 ? (
                      <AppText
                        variant="micro"
                        color={palette.faint}
                        numberOfLines={1}
                        style={{ fontSize: 8.5, flex: 1 }}
                      >
                        To {item.dto.toAddresses.map((a) => a.name || a.email).join(", ")}
                        {item.dto.ccAddresses.length > 0
                          ? ` · Cc ${item.dto.ccAddresses.map((a) => a.name || a.email).join(", ")}`
                          : ""}
                      </AppText>
                    ) : null}
                  </View>

                  {(item.dto.spf || item.dto.dkim || item.dto.dmarc) ? (
                    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
                      {item.dto.spf ? (
                        <Badge label={`SPF ${item.dto.spf}`} tone={item.dto.spf === "pass" ? "mint" : "warning"} />
                      ) : null}
                      {item.dto.dkim ? (
                        <Badge label={`DKIM ${item.dto.dkim}`} tone={item.dto.dkim === "pass" ? "mint" : "warning"} />
                      ) : null}
                      {item.dto.dmarc ? (
                        <Badge label={`DMARC ${item.dto.dmarc}`} tone={item.dto.dmarc === "pass" ? "mint" : "warning"} />
                      ) : null}
                    </View>
                  ) : null}

                  <EmailBody html={item.body.html} text={item.body.text} />

                  {item.body.attachments.length > 0 ? (
                    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Feather name="paperclip" size={12} color={palette.faint} />
                        <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                          {item.body.attachments.length} encrypted attachment
                          {item.body.attachments.length === 1 ? "" : "s"}
                        </AppText>
                      </View>
                      {item.body.attachments.map((attachment) => (
                        <Touchable
                          key={attachment.blobId}
                          onPress={() => void downloadAttachment(attachment)}
                          haptic="light"
                          style={[
                            styles.attachment,
                            { backgroundColor: palette.surfaceRaised, borderColor: palette.border },
                          ]}
                        >
                          <View style={[styles.fileBadge, { backgroundColor: palette.accentSoft }]}>
                            <Feather name="file" size={14} color={palette.accent} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <AppText variant="caption" weight="medium" numberOfLines={1}>
                              {attachment.filename}
                            </AppText>
                            <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                              {formatBytes(attachment.sizeBytes)} · tap to decrypt & share
                            </AppText>
                          </View>
                          {downloading === attachment.blobId ? (
                            <ActivityIndicator size="small" color={palette.accent} />
                          ) : (
                            <Feather name="download" size={15} color={palette.faint} />
                          )}
                        </Touchable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.collapsedBody}>
                  <AppText
                    variant="caption"
                    color={palette.muted}
                    numberOfLines={2}
                    style={{ lineHeight: 18 }}
                  >
                    {truncate(snippet, 140)}
                  </AppText>
                </View>
              )}
            </View>
          );
        }}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor={palette.accent}
            colors={[palette.accent]}
          />
        }
        ListFooterComponent={<View style={{ height: spacing.md }} />}
      />

      <View
        style={[
          styles.replyBar,
          {
            paddingBottom: Math.max(insets.bottom, spacing.md),
            backgroundColor: palette.canvasRaised,
            borderTopColor: palette.borderSoft,
          },
        ]}
      >
        <ReplyButton
          icon="corner-up-left"
          label="Reply"
          primary
          onPress={() => replySource && openCompose({ mode: "reply", source: replySource })}
        />
        <ReplyButton
          icon="users"
          label="Reply all"
          onPress={() =>
            replySource &&
            openCompose({ mode: "replyAll", source: replySource })
          }
        />
        <ReplyButton
          icon="corner-up-right"
          label="Forward"
          onPress={() =>
            replySource && openCompose({ mode: "forward", source: replySource })
          }
        />
      </View>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Conversation"
        items={[
          {
            label: "Add or remove labels",
            icon: "tag",
            onPress: () => setLabelOpen(true),
          },
          {
            label: "Move to folder",
            icon: "folder",
            onPress: () => setMoveOpen(true),
          },
          {
            label: "Mark as unread",
            icon: "mail",
            onPress: () => void action("unread"),
          },
          {
            label: "Snooze for 1 hour",
            icon: "clock",
            onPress: () =>
              void action("snooze", {
                snoozeUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              }),
          },
          {
            label: "Move to spam",
            icon: "slash",
            tone: "danger",
            onPress: () => void action("spam"),
          },
          {
            label: "Archive conversation",
            icon: "archive",
            onPress: () => void action("archive"),
          },
          {
            label: "Delete conversation",
            icon: "trash-2",
            tone: "danger",
            onPress: requestDelete,
          },
        ]}
      />

      <Sheet
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Move conversation"
        description="Pick a destination folder."
      >
        <View style={{ paddingBottom: spacing.md }}>
          {folders.map((folder) => (
            <Touchable
              key={folder.id}
              onPress={() => {
                setMoveOpen(false);
                void action("move", { folderId: folder.id });
              }}
              haptic="light"
              style={[styles.folderRow, { borderBottomColor: palette.borderSoft }]}
            >
              <View
                style={[
                  styles.folderIcon,
                  {
                    backgroundColor:
                      folder.type === "TRASH" || folder.type === "SPAM"
                        ? palette.dangerSoft
                        : folder.type === "INBOX"
                          ? palette.accentSoft
                          : palette.surface,
                  },
                ]}
              >
                <Feather
                  name={
                    folder.type === "INBOX"
                      ? "inbox"
                      : folder.type === "SENT"
                        ? "send"
                        : folder.type === "DRAFTS"
                          ? "file-text"
                          : folder.type === "ARCHIVE"
                            ? "archive"
                            : folder.type === "SPAM"
                              ? "slash"
                              : folder.type === "TRASH"
                                ? "trash-2"
                                : "folder"
                  }
                  size={15}
                  color={folder.type === "TRASH" || folder.type === "SPAM" ? palette.danger : palette.accent}
                />
              </View>
              <AppText variant="small" weight="medium" style={{ flex: 1 }}>
                {folder.name}
              </AppText>
              <Feather name="chevron-right" size={15} color={palette.faint} />
            </Touchable>
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={labelOpen}
        onClose={() => setLabelOpen(false)}
        title="Labels"
        description="Labels sync across every message in this conversation."
      >
        <View style={{ paddingBottom: spacing.md }}>
          {labels.length === 0 ? (
            <EmptyState
              compact
              icon="tag"
              title="No labels yet"
              description="Create labels in Settings → Labels to organise conversations."
            />
          ) : (
            labels.map((label) => {
              const active = threadLabels.some((item) => item.id === label.id);
              return (
                <Touchable
                  key={label.id}
                  onPress={() => void toggleLabel(label)}
                  haptic="light"
                  style={[styles.folderRow, { borderBottomColor: palette.borderSoft }]}
                >
                  <View
                    style={[
                      styles.folderIcon,
                      { backgroundColor: active ? `${label.color}22` : palette.surface },
                    ]}
                  >
                    <View style={[styles.labelDot, { backgroundColor: label.color, width: 9, height: 9 }]} />
                  </View>
                  <AppText variant="small" weight="medium" style={{ flex: 1 }}>
                    {label.name}
                  </AppText>
                  <View
                    style={[
                      styles.toggleBox,
                      {
                        backgroundColor: active ? palette.accent : "transparent",
                        borderColor: active ? palette.accent : palette.borderStrong,
                      },
                    ]}
                  >
                    {active ? <Feather name="check" size={12} color="#FFFFFF" /> : null}
                  </View>
                </Touchable>
              );
            })
          )}
        </View>
      </Sheet>
    </View>
  );
}

function ReplyButton({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const palette = usePalette();
  return (
    <Touchable
      onPress={onPress}
      haptic="medium"
      accessibilityLabel={label}
      style={[
        styles.replyButton,
        primary && { backgroundColor: palette.accentSoft },
      ]}
    >
      <Feather name={icon} size={17} color={primary ? palette.accent : palette.inkSoft} />
      <AppText
        variant="micro"
        color={primary ? palette.accentStrong : palette.muted}
        style={{ fontSize: 9 }}
      >
        {label}
      </AppText>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  encryptedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  labelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  labelDot: { width: 5, height: 5, borderRadius: 3 },
  threadDivider: { height: StyleSheet.hairlineWidth },
  messageCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  messageBody: { paddingTop: spacing.lg, gap: spacing.md },
  detailsRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  collapsedBody: { paddingLeft: 50, paddingTop: spacing.xs },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileBadge: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  replyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  skeletonCard: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
