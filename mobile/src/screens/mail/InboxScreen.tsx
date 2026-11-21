import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  RefreshControl,
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
import { useMailData } from "../../lib/mail-data";
import { useCompose } from "../../compose/ComposeProvider";
import { useMailList, previewOf } from "../../hooks/useMailList";
import { useMailEvent } from "../../lib/mailBus";
import { apiFetch } from "../../lib/api";
import type { MailListItem } from "../../hooks/useMailList";
import type { TabScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";
import { Chip, CountDot } from "../../components/ui/Chip";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { Dropdown } from "../../components/ui/Dropdown";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { LogoMark } from "../../components/ui/Logo";
import { MailListSkeleton } from "../../components/ui/Skeleton";
import { Sheet } from "../../components/ui/Sheet";
import { SwipeableRow } from "../../components/ui/SwipeableRow";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";
import { MailRow } from "../../components/mail/MailRow";

const SYSTEM_FOLDERS: { key: string; label: string }[] = [
  { key: "INBOX", label: "Inbox" },
  { key: "STARRED", label: "Starred" },
  { key: "SENT", label: "Sent" },
  { key: "DRAFTS", label: "Drafts" },
  { key: "ARCHIVE", label: "Archive" },
  { key: "SPAM", label: "Spam" },
  { key: "TRASH", label: "Trash" },
];

type SortMode = "newest" | "oldest" | "unread" | "attachments";

function isUnread(item: MailListItem): boolean {
  return item.thread.unreadCount > 0 || !item.thread.latest.isRead;
}

function AnimatedRow({ children }: { children: React.ReactNode }) {
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [appear]);
  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [
          {
            translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

export function InboxScreen({ navigation }: TabScreenProps<"Mail">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { folders, labels, unread, refreshFolders, refreshUnread } = useMailData();
  const { open: openCompose } = useCompose();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [folder, setFolder] = useState("INBOX");
  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [moveOpen, setMoveOpen] = useState(false);
  const list = useMailList(folder, labelId);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSelection = selected.size > 0;
  const selectionMode = isSelection;

  const visibleItems = useMemo(() => {
    const items = [...list.items];
    const time = (item: MailListItem) => new Date(item.thread.latest.sentAt).getTime();
    if (sortMode === "attachments") {
      return items
        .filter(
          (item) =>
            item.thread.latest.attachments.length > 0 ||
            Boolean(item.decrypted?.body.attachments.length),
        )
        .sort((a, b) => time(b) - time(a));
    }
    if (sortMode === "oldest") return items.sort((a, b) => time(a) - time(b));
    if (sortMode === "unread") {
      return items.sort((a, b) => Number(isUnread(b)) - Number(isUnread(a)) || time(b) - time(a));
    }
    return items.sort((a, b) => time(b) - time(a));
  }, [list.items, sortMode]);

  const moveTargets = useMemo(
    () =>
      folders.filter(
        (target) =>
          target.id !== folder &&
          (target.type === "CUSTOM" || target.type === "ARCHIVE" || target.type === "INBOX"),
      ),
    [folder, folders],
  );

  useEffect(() => {
    setSelected(new Set());
  }, [folder, labelId]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      list.refresh().catch(() => undefined);
    }, 350);
  }, [list]);

  useMailEvent((event) => {
    if (
      event.type === "sent" ||
      event.type === "mail-changed" ||
      event.type === "thread-updated" ||
      (event.type === "draft-saved" && folder === "DRAFTS")
    ) {
      scheduleReload();
    }
  });

  useEffect(() => {
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, []);

  const folderMeta = useMemo(() => {
    const custom = folders.find((item) => item.id === folder);
    if (custom) {
      return {
        label: custom.name,
        count: custom.unreadCount ?? 0,
        type: custom.type,
        description: "Custom folder",
      };
    }
    const entry = SYSTEM_FOLDERS.find((item) => item.key === folder);
    if (folder === "STARRED") {
      return { label: "Starred", count: 0, type: "STARRED", description: "Messages you starred" };
    }
    if (folder === "INBOX") {
      return { label: "Inbox", count: unread, type: "INBOX", description: "End-to-end encrypted" };
    }
    return {
      label: entry?.label ?? "Mail",
      count: 0,
      type: folder,
      description:
        folder === "SENT"
          ? "Delivered from this account"
          : folder === "DRAFTS"
            ? "Encrypted drafts"
            : folder === "ARCHIVE"
              ? "Out of the way, still here"
              : folder === "SPAM"
                ? "Filtered automatically"
                : folder === "TRASH"
                  ? "Deleted in the last 30 days"
                  : "Mail",
    };
  }, [folder, folders, unread]);

  const threadAction = useCallback(
    async (threadId: string, action: string, extra?: Record<string, unknown>) => {
      await apiFetch(`/api/v1/threads/${threadId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, ...extra }),
      });
    },
    [],
  );

  const afterMutation = useCallback(() => {
    refreshFolders().catch(() => undefined);
    refreshUnread().catch(() => undefined);
  }, [refreshFolders, refreshUnread]);

  const toggleStar = useCallback(
    async (item: MailListItem) => {
      const starred = item.thread.latest.isStarred;
      list.mutateThread(item.thread.id, (thread) => ({
        ...thread,
        latest: { ...thread.latest, isStarred: !starred },
      }));
      try {
        await threadAction(item.thread.id, starred ? "unstar" : "star");
      } catch {
        list.mutateThread(item.thread.id, (thread) => ({
          ...thread,
          latest: { ...thread.latest, isStarred: starred },
        }));
        toast({ title: "Could not update the star", tone: "error" });
      }
    },
    [list, threadAction, toast],
  );

  const moveThread = useCallback(
    async (item: MailListItem, action: "archive" | "trash" | "spam" | "inbox") => {
      list.removeThread(item.thread.id);
      try {
        await threadAction(item.thread.id, action);
        afterMutation();
        toast({
          title:
            action === "archive"
              ? "Archived"
              : action === "trash"
                ? "Moved to trash"
                : action === "spam"
                  ? "Moved to spam"
                  : "Restored to inbox",
          description: action === "trash" ? "Restore it within 30 days." : undefined,
          tone: "default",
          action:
            action === "archive" || action === "trash" || action === "spam"
              ? {
                  label: "Undo",
                  onPress: async () => {
                    try {
                      await threadAction(item.thread.id, "move", {
                        folderId: item.thread.latest.folderId,
                      });
                      await list.refresh();
                      afterMutation();
                      toast({ title: "Restored", tone: "success" });
                    } catch {
                      toast({ title: "Could not undo that action", tone: "error" });
                    }
                  },
                }
              : undefined,
        });
        if (action === "trash" && item.thread.latest.isDraft) refreshFolders().catch(() => undefined);
      } catch {
        scheduleReload();
        toast({ title: "That action could not be completed", tone: "error" });
      }
    },
    [afterMutation, list, refreshFolders, scheduleReload, threadAction, toast],
  );

  const permanentlyDelete = useCallback(
    async (item: MailListItem) => {
      const data = await apiFetch<{ messages: { id: string }[] }>(
        `/api/v1/threads/${item.thread.id}`,
      );
      await Promise.all(
        data.messages.map((message) =>
          apiFetch(`/api/v1/messages/${message.id}?permanent=true`, { method: "DELETE" }),
        ),
      );
      list.removeThread(item.thread.id);
      afterMutation();
    },
    [afterMutation, list],
  );

  const requestTrash = useCallback(
    (item: MailListItem) => {
      const preview = previewOf(item);
      void confirm({
        title: "Move to trash?",
        description:
          "The conversation leaves this view. You can restore it from Trash within 30 days.",
        confirmLabel: "Move to trash",
        tone: "warning",
        icon: "trash-2",
        details: [{ label: "Subject", value: preview.subject }],
        onConfirm: () => moveThread(item, "trash"),
      });
    },
    [confirm, moveThread],
  );

  const requestDeleteForever = useCallback(
    (item: MailListItem) => {
      const preview = previewOf(item);
      void confirm({
        title: "Delete forever?",
        description:
          "This permanently deletes the conversation and its encrypted attachments. It cannot be undone.",
        confirmLabel: "Delete forever",
        tone: "danger",
        icon: "trash-2",
        details: [{ label: "Subject", value: preview.subject }],
        onConfirm: async () => {
          try {
            await permanentlyDelete(item);
            toast({ title: "Deleted permanently", tone: "success" });
          } catch {
            toast({ title: "The conversation could not be deleted", tone: "error" });
          }
        },
      });
    },
    [confirm, permanentlyDelete, toast],
  );

  const openThread = useCallback(
    async (item: MailListItem) => {
      if (isSelection) {
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(item.thread.id)) next.delete(item.thread.id);
          else next.add(item.thread.id);
          return next;
        });
        return;
      }
      if (item.thread.latest.isDraft && item.decrypted) {
        openCompose({ mode: "draft", source: item.decrypted });
        return;
      }
      navigation.navigate("Thread", {
        id: item.thread.id,
        folderType: item.thread.latest.folderType,
        subject: item.decrypted?.subject,
      });
    },
    [isSelection, navigation, openCompose],
  );

  const performBulkAction = useCallback(
    async (action: "archive" | "trash" | "read" | "unread" | "star" | "unstar") => {
      if (busyAction) return;
      setBusyAction(true);
      const items = list.items.filter((item) => selected.has(item.thread.id));
      const ids = items.map((item) => item.thread.id);

      if (action === "trash" && folder === "TRASH") {
        const results = await Promise.allSettled(items.map((item) => permanentlyDelete(item)));
        const failed = results.filter((result) => result.status === "rejected").length;
        setSelected(new Set());
        setBusyAction(false);
        toast({
          title:
            failed > 0
              ? `${ids.length - failed} deleted, ${failed} failed`
              : `${ids.length} conversation${ids.length === 1 ? "" : "s"} deleted forever`,
          tone: failed > 0 ? "error" : "success",
        });
        return;
      }

      const results = await Promise.allSettled(ids.map((id) => threadAction(id, action)));
      const failed = results.filter((result) => result.status === "rejected").length;
      const succeeded = ids.filter((_, index) => results[index].status === "fulfilled");
      const originals = list.items
        .filter((item) => ids.includes(item.thread.id))
        .map((item) => ({ id: item.thread.id, folderId: item.thread.latest.folderId }));
      if (action === "archive" || action === "trash") {
        succeeded.forEach((id) => list.removeThread(id));
      } else {
        ids.forEach((id) =>
          list.mutateThread(id, (thread) => ({
            ...thread,
            unreadCount: action === "unread" ? Math.max(1, thread.unreadCount) : 0,
            latest: {
              ...thread.latest,
              isRead: action !== "unread",
              isStarred: action === "star" ? true : action === "unstar" ? false : thread.latest.isStarred,
            },
          })),
        );
      }
      setSelected(new Set());
      setBusyAction(false);
      afterMutation();
      toast({
        title:
          failed > 0
            ? `${ids.length - failed} updated, ${failed} failed`
            : action === "archive"
              ? `${ids.length} archived`
              : action === "trash"
                ? `${ids.length} moved to trash`
                : "Conversations updated",
        tone: failed > 0 ? "error" : "success",
        action:
          (action === "archive" || action === "trash") && failed === 0
            ? {
                label: "Undo",
                onPress: async () => {
                  await Promise.allSettled(
                    originals.map((original) =>
                      threadAction(original.id, "move", { folderId: original.folderId }),
                    ),
                  );
                  await list.refresh();
                  afterMutation();
                  toast({ title: "Conversations restored", tone: "success" });
                },
              }
            : undefined,
      });
    },
    [afterMutation, busyAction, folder, list, permanentlyDelete, selected, threadAction, toast],
  );

  const requestBulkAction = useCallback(
    (action: "archive" | "trash" | "read" | "unread" | "star" | "unstar") => {
      const count = selected.size;
      if (count === 0) return;
      const permanent = action === "trash" && folder === "TRASH";
      if (action === "archive" || action === "trash") {
        void confirm({
          title: permanent
            ? `Delete ${count} conversation${count === 1 ? "" : "s"} forever?`
            : action === "archive"
              ? `Archive ${count} conversation${count === 1 ? "" : "s"}?`
              : `Move ${count} conversation${count === 1 ? "" : "s"} to trash?`,
          description: permanent
            ? "The selected conversations and their encrypted attachments will be permanently removed. This cannot be undone."
            : action === "archive"
              ? "They leave this view but stay searchable in Archive."
              : "You can restore them from Trash within 30 days.",
          confirmLabel: permanent
            ? "Delete forever"
            : action === "archive"
              ? "Archive"
              : "Move to trash",
          tone: permanent || action === "trash" ? "danger" : "warning",
          icon: action === "archive" ? "archive" : "trash-2",
          count,
          onConfirm: () => performBulkAction(action),
        });
        return;
      }
      void performBulkAction(action);
    },
    [confirm, folder, performBulkAction, selected],
  );

  const requestBulkMove = useCallback(
    (target: { id: string; name: string }) => {
      const count = selected.size;
      if (count === 0) return;
      void confirm({
        title: `Move ${count} conversation${count === 1 ? "" : "s"}?`,
        description: `They will be moved to ${target.name}. Nothing is deleted.`,
        confirmLabel: "Move",
        tone: "accent",
        icon: "folder",
        count,
        onConfirm: async () => {
          const ids = Array.from(selected);
          const originals = list.items
            .filter((item) => ids.includes(item.thread.id))
            .map((item) => ({ id: item.thread.id, folderId: item.thread.latest.folderId }));
          const results = await Promise.allSettled(
            ids.map((id) => threadAction(id, "move", { folderId: target.id })),
          );
          const failed = results.filter((result) => result.status === "rejected").length;
          ids
            .filter((_, index) => results[index].status === "fulfilled")
            .forEach((id) => list.removeThread(id));
          setSelected(new Set());
          afterMutation();
          toast({
            title:
              failed > 0
                ? `${ids.length - failed} moved, ${failed} failed`
                : `${ids.length} moved to ${target.name}`,
            tone: failed > 0 ? "error" : "success",
            action:
              failed === 0
                ? {
                    label: "Undo",
                    onPress: async () => {
                      await Promise.allSettled(
                        originals.map((original) =>
                          threadAction(original.id, "move", { folderId: original.folderId }),
                        ),
                      );
                      await list.refresh();
                      afterMutation();
                      toast({ title: "Conversations restored", tone: "success" });
                    },
                  }
                : undefined,
          });
        },
      });
    },
    [afterMutation, confirm, list, selected, threadAction, toast],
  );

  const onLongPress = (item: MailListItem) => {
    setSelected((current) => new Set(current).add(item.thread.id));
  };

  const selectAll = () => {
    setSelected(new Set(visibleItems.map((item) => item.thread.id)));
  };

  const header = isSelection ? (
    <View style={[styles.selectionBar, { paddingTop: insets.top + spacing.sm }]}>
      <IconButton
        name="x"
        size={38}
        accessibilityLabel="Cancel selection"
        onPress={() => setSelected(new Set())}
      />
      <View style={{ flex: 1 }}>
        <AppText variant="heading" weight="semibold">
          {selected.size} selected
        </AppText>
      </View>
      <IconButton
        name="check-square"
        size={36}
        accessibilityLabel="Select all"
        onPress={selectAll}
      />
      <IconButton
        name="folder"
        size={36}
        iconSize={18}
        accessibilityLabel="Move selected"
        onPress={() => setMoveOpen(true)}
      />
      <IconButton
        name="archive"
        size={36}
        iconSize={18}
        accessibilityLabel="Archive selected"
        onPress={() => requestBulkAction("archive")}
      />
      <IconButton
        name="trash-2"
        size={36}
        iconSize={18}
        color={palette.danger}
        accessibilityLabel={folder === "TRASH" ? "Delete selected forever" : "Delete selected"}
        onPress={() => requestBulkAction("trash")}
      />
      <IconButton
        name="mail"
        size={36}
        iconSize={18}
        accessibilityLabel="Mark read"
        onPress={() => requestBulkAction("read")}
      />
      <IconButton
        name="star"
        size={36}
        iconSize={18}
        accessibilityLabel="Star selected"
        onPress={() => requestBulkAction("star")}
      />
    </View>
  ) : (
    <View style={{ paddingTop: insets.top + spacing.sm }}>
      <View style={styles.topBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <LogoMark size={24} />
          <AppText variant="micro" color={palette.faint} style={{ fontSize: 9.5 }}>
            NyxMail
          </AppText>
          <View style={[styles.lockPill, { backgroundColor: palette.mintSoft }]}>
            <Feather name="lock" size={8} color={palette.mint} />
            <AppText variant="micro" color={palette.mint} style={{ fontSize: 7.5 }}>
              Encrypted
            </AppText>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Dropdown
            title="SORT & FILTER"
            options={[
              { key: "newest", label: "Newest first", icon: "clock", selected: sortMode === "newest" },
              { key: "oldest", label: "Oldest first", icon: "archive", selected: sortMode === "oldest" },
              { key: "unread", label: "Unread first", icon: "mail", selected: sortMode === "unread" },
              {
                key: "attachments",
                label: "With attachments",
                icon: "paperclip",
                selected: sortMode === "attachments",
                hint: "Only show mail with files",
              },
            ]}
            onSelect={(key) => setSortMode(key as SortMode)}
            trigger={({ toggle }) => (
              <IconButton
                name="sliders"
                size={36}
                color={sortMode === "newest" ? palette.inkSoft : palette.accent}
                accessibilityLabel="Sort and filter mail"
                onPress={toggle}
              />
            )}
          />
          <IconButton
            name="search"
            size={36}
            accessibilityLabel="Search mail"
            onPress={() => navigation.navigate("Search")}
          />
          <Touchable
            onPress={() => navigation.navigate("Settings")}
            haptic="light"
            accessibilityLabel="Open settings"
            style={{ marginLeft: 2 }}
          >
            <Avatar name={user?.displayName} email={user?.email} size={32} ring />
          </Touchable>
        </View>
      </View>

      <View style={styles.titleRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <AppText variant="display" weight="bold">
              {folderMeta.label}
            </AppText>
            {folderMeta.count > 0 ? <CountDot count={folderMeta.count} /> : null}
          </View>
          <AppText variant="caption" color={palette.muted}>
            {folderMeta.description}
          </AppText>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.folderStrip}
      >
        {SYSTEM_FOLDERS.map((entry) => (
          <Chip
            key={entry.key}
            label={entry.label}
            selected={folder === entry.key}
            count={
              entry.key === "INBOX"
                ? folders.find((item) => item.type === "INBOX")?.unreadCount ?? unread
                : undefined
            }
            onPress={() => setFolder(entry.key)}
          />
        ))}
        {folders
          .filter((item) => item.type === "CUSTOM")
          .map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              selected={folder === item.id}
              count={item.unreadCount}
              onPress={() => setFolder(item.id)}
            />
          ))}
      </ScrollView>

      {labels.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.labelStrip}
        >
          <View style={[styles.labelTag, { borderColor: palette.border }]}>
            <Feather name="tag" size={10} color={palette.faint} />
          </View>
          {labels.map((label) => (
            <Touchable
              key={label.id}
              onPress={() => setLabelId(labelId === label.id ? undefined : label.id)}
              haptic="light"
              style={[
                styles.labelChip,
                {
                  backgroundColor: labelId === label.id ? palette.accentSoft : "transparent",
                  borderColor: labelId === label.id ? palette.accent : palette.borderSoft,
                },
              ]}
            >
              <View style={[styles.labelColor, { backgroundColor: label.color }]} />
              <AppText
                variant="micro"
                color={labelId === label.id ? palette.accentStrong : palette.muted}
                style={{ fontSize: 9, letterSpacing: 0.1 }}
              >
                {label.name}
              </AppText>
            </Touchable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <LinearGradient
        colors={["rgba(138,120,255,0.10)", "rgba(8,9,13,0)"]}
        style={styles.headerGlow}
        pointerEvents="none"
      />
      {header}

      {list.loading && list.items.length === 0 ? (
        <MailListSkeleton rows={7} />
      ) : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.thread.id}
          renderItem={({ item }) => (
            <AnimatedRow>
              <SwipeableRow
                enabled={!isSelection && folder !== "DRAFTS"}
                actions={
                  folder === "TRASH"
                    ? [
                        {
                          icon: "inbox",
                          label: "Restore",
                          color: palette.accent,
                          onPress: () => void moveThread(item, "inbox"),
                        },
                        {
                          icon: "trash-2",
                          label: "Forever",
                          color: palette.danger,
                          onPress: () => requestDeleteForever(item),
                        },
                      ]
                    : folder === "SPAM" || folder === "ARCHIVE"
                      ? [
                          {
                            icon: "inbox",
                            label: "Inbox",
                            color: palette.accent,
                            onPress: () => void moveThread(item, "inbox"),
                          },
                          {
                            icon: "trash-2",
                            label: "Trash",
                            color: palette.danger,
                            onPress: () => requestTrash(item),
                          },
                        ]
                      : [
                          {
                            icon: "archive",
                            label: "Archive",
                            color: palette.accent,
                            onPress: () => void moveThread(item, "archive"),
                          },
                          {
                            icon: "trash-2",
                            label: "Trash",
                            color: palette.danger,
                            onPress: () => requestTrash(item),
                          },
                        ]
                }
              >
                <MailRow
                  item={item}
                  selected={selected.has(item.thread.id)}
                  selectionMode={selectionMode}
                  onPress={() => void openThread(item)}
                  onLongPress={() => onLongPress(item)}
                  onToggleStar={() => void toggleStar(item)}
                />
              </SwipeableRow>
            </AnimatedRow>
          )}
          contentContainerStyle={{
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + 180,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={list.refresh}
              tintColor={palette.accent}
              colors={[palette.accent]}
              progressBackgroundColor={palette.surface}
            />
          }
          onEndReached={() => void list.loadMore()}
          onEndReachedThreshold={0.4}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          ListFooterComponent={
            list.loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={palette.accent} />
              </View>
            ) : list.items.length > 0 && !list.nextPage ? (
              <View style={styles.footer}>
                <View style={[styles.footerLine, { backgroundColor: palette.borderSoft }]} />
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                  End-to-end encrypted
                </AppText>
                <View style={[styles.footerLine, { backgroundColor: palette.borderSoft }]} />
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState
              icon={
                sortMode === "attachments"
                  ? "paperclip"
                  : folder === "SENT"
                    ? "send"
                    : folder === "DRAFTS"
                      ? "file-text"
                      : folder === "TRASH"
                        ? "trash-2"
                        : folder === "STARRED"
                          ? "star"
                          : "inbox"
              }
              title={
                sortMode === "attachments"
                  ? "No attachments"
                  : folder === "INBOX"
                    ? "Inbox zero"
                    : folder === "STARRED"
                      ? "No starred mail"
                      : folder === "SENT"
                        ? "Nothing sent yet"
                        : folder === "DRAFTS"
                          ? "No drafts"
                          : folder === "TRASH"
                            ? "Trash is empty"
                            : "Nothing here yet"
              }
              description={
                sortMode === "attachments"
                  ? "Nothing with files in this view. Switch the sort filter or choose another folder."
                  : folder === "INBOX"
                    ? "You are all caught up. New encrypted mail will land here."
                    : folder === "DRAFTS"
                      ? "Unsent messages are encrypted and saved here automatically."
                      : folder === "TRASH"
                        ? "Deleted mail is removed permanently after 30 days."
                        : "Messages will appear here when they arrive."
              }
              actionLabel={
                sortMode === "attachments"
                  ? "Show all mail"
                  : folder === "INBOX" && !labelId
                    ? "Write a message"
                    : undefined
              }
              onAction={() =>
                sortMode === "attachments"
                  ? setSortMode("newest")
                  : openCompose({ mode: "new" })
              }
            />
          }
        />
      )}

      {!isSelection && folder !== "DRAFTS" ? (
        <Touchable
          onPress={() => openCompose({ mode: "new" })}
          haptic="medium"
          accessibilityLabel="Compose a new message"
          style={[
            styles.fab,
            {
              bottom: Math.max(insets.bottom, spacing.md) + 78,
              shadowColor: palette.accent,
            },
          ]}
        >
          <LinearGradient
            colors={[palette.gradient[0], palette.gradient[1], palette.gradient[2]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabInner}
          >
            <Feather name="edit-3" size={21} color="#FFFFFF" />
          </LinearGradient>
        </Touchable>
      ) : null}

      <Sheet
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Move conversations"
        description={`${selected.size} selected · choose a destination`}
      >
        <View style={{ paddingBottom: spacing.md }}>
          {moveTargets.length === 0 ? (
            <EmptyState
              compact
              icon="folder"
              title="No other folders"
              description="Create a folder in Settings → Folders to move mail here."
            />
          ) : (
            moveTargets.map((target) => (
                <Touchable
                  key={target.id}
                  onPress={() => {
                    setMoveOpen(false);
                    requestBulkMove(target);
                  }}
                  haptic="light"
                  style={[styles.folderRow, { borderBottomColor: palette.borderSoft }]}
                >
                  <View
                    style={[
                      styles.folderIcon,
                      {
                        backgroundColor:
                          target.type === "SPAM" ? palette.dangerSoft : palette.accentSoft,
                      },
                    ]}
                  >
                    <Feather
                      name={
                        target.type === "INBOX"
                          ? "inbox"
                          : target.type === "SENT"
                            ? "send"
                            : target.type === "DRAFTS"
                              ? "file-text"
                              : target.type === "ARCHIVE"
                                ? "archive"
                                : target.type === "SPAM"
                                  ? "slash"
                                  : "folder"
                      }
                      size={15}
                      color={target.type === "SPAM" ? palette.danger : palette.accent}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="small" weight="medium">
                      {target.name}
                    </AppText>
                    <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                      {target.type === "CUSTOM" ? "Custom folder" : "System folder"}
                    </AppText>
                  </View>
                  <Feather name="chevron-right" size={15} color={palette.faint} />
                </Touchable>
              ))
          )}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  headerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  lockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },
  folderStrip: {
    paddingHorizontal: spacing.lg,
    gap: 6,
    paddingBottom: spacing.sm,
  },
  labelStrip: {
    paddingHorizontal: spacing.lg,
    gap: 6,
    paddingBottom: spacing.sm,
    alignItems: "center",
  },
  labelTag: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  labelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  labelColor: { width: 5, height: 5, borderRadius: 3 },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xxxl,
  },
  footerLine: { flex: 1, height: StyleSheet.hairlineWidth },
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
  fab: {
    position: "absolute",
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  fabInner: {
    flex: 1,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});
