import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/api";
import { decryptMessage } from "../../lib/crypto";
import { htmlToText, truncate } from "../../lib/format";
import { useMailEvent } from "../../lib/mailBus";
import type { FolderType } from "../../lib/types";
import type { TabScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";
import { Chip } from "../../components/ui/Chip";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { Touchable } from "../../components/ui/Touchable";

interface IndexedMessage {
  id: string;
  threadId: string;
  folderType: FolderType;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  subject: string;
  body: string;
  sentAt: string;
  isRead: boolean;
  isStarred: boolean;
}

interface SearchResponse {
  messages: {
    id: string;
    threadId: string;
    folderType: FolderType;
    fromAddress: string;
    fromName: string | null;
    toAddresses: string[];
    encryptedSubject: string;
    encryptedBody: string;
    wrappedKey: string;
    sentAt: string;
    isRead: boolean;
    isStarred: boolean;
  }[];
}

const filters: { key: string; label: string }[] = [
  { key: "ALL", label: "All mail" },
  { key: "INBOX", label: "Inbox" },
  { key: "SENT", label: "Sent" },
  { key: "STARRED", label: "Starred" },
  { key: "ARCHIVE", label: "Archive" },
];

function Highlight({ text, query, color, muted }: { text: string; query: string; color: string; muted?: string }) {
  const needle = query.trim();
  if (!needle) {
    return (
      <AppText variant="caption" color={muted} numberOfLines={2}>
        {text}
      </AppText>
    );
  }
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) {
    return (
      <AppText variant="caption" color={muted} numberOfLines={2}>
        {text}
      </AppText>
    );
  }
  const start = text.slice(0, index);
  const match = text.slice(index, index + needle.length);
  const end = text.slice(index + needle.length);
  return (
    <AppText variant="caption" color={muted} numberOfLines={2}>
      {start}
      <AppText variant="caption" weight="semibold" color={color}>
        {match}
      </AppText>
      {end}
    </AppText>
  );
}

export function SearchScreen({ navigation }: TabScreenProps<"Search">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { keys, user } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [index, setIndex] = useState<IndexedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const stale = useRef(false);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const loadIndex = useCallback(async () => {
    if (!keys) return;
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      const data = await apiFetch<SearchResponse>("/api/v1/messages/search-index?limit=400");
      const results: IndexedMessage[] = [];
      const batchSize = 12;
      for (let index = 0; index < data.messages.length; index += batchSize) {
        const batch = data.messages.slice(index, index + batchSize);
        const decrypted = await Promise.all(
          batch.map(async (message) => {
            try {
              const opened = await decryptMessage<{ html?: string; text?: string }>(
                message.encryptedSubject,
                message.encryptedBody,
                message.wrappedKey,
                keys.privateKey,
                keys.publicKey,
              );
              return {
                id: message.id,
                threadId: message.threadId,
                folderType: message.folderType,
                fromAddress: message.fromAddress,
                fromName: message.fromName,
                to: message.toAddresses,
                subject: opened.subject || "(no subject)",
                body: opened.payload.text || htmlToText(opened.payload.html || ""),
                sentAt: message.sentAt,
                isRead: message.isRead,
                isStarred: message.isStarred,
              } satisfies IndexedMessage;
            } catch {
              return null;
            }
          }),
        );
        results.push(...decrypted.filter((item): item is IndexedMessage => Boolean(item)));
        setProgress(Math.round(((index + batch.length) / Math.max(1, data.messages.length)) * 100));
      }
      setIndex(results);
      loadedFor.current = user?.id ?? null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search index could not be built.");
    } finally {
      setLoading(false);
    }
  }, [keys, user?.id]);

  useEffect(() => {
    if (!user) return;
    if (loadedFor.current === user.id) return;
    if (loadedFor.current === null) void loadIndex();
  }, [loadIndex, user]);

  useMailEvent((event) => {
    if (event.type === "sent" || event.type === "mail-changed") {
      stale.current = true;
    }
  });

  useFocusEffect(
    React.useCallback(() => {
      if (stale.current && user) {
        stale.current = false;
        void loadIndex();
      }
    }, [loadIndex, user]),
  );

  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return [];
    return index
      .filter((message) => {
        if (unreadOnly && message.isRead) return false;
        if (filter === "STARRED" && !message.isStarred) return false;
        if (filter !== "ALL" && filter !== "STARRED" && message.folderType !== filter) return false;
        return (
          message.subject.toLowerCase().includes(needle) ||
          message.body.toLowerCase().includes(needle) ||
          message.fromAddress.toLowerCase().includes(needle) ||
          (message.fromName ?? "").toLowerCase().includes(needle) ||
          message.to.some((address) => address.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      .slice(0, 80);
  }, [deferredQuery, filter, index, unreadOnly]);

  const snippetFor = (message: IndexedMessage) => {
    const needle = deferredQuery.trim().toLowerCase();
    const body = message.body.replace(/\s+/g, " ").trim();
    const at = needle ? body.toLowerCase().indexOf(needle) : -1;
    if (at < 0) return truncate(body, 110);
    const start = Math.max(0, at - 35);
    return `${start > 0 ? "…" : ""}${body.slice(start, start + 120)}${start + 120 < body.length ? "…" : ""}`;
  };

  const header = (
    <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.xl, gap: spacing.lg }}>
      <View style={styles.titleRow}>
        <View>
          <AppText variant="display" weight="bold">
            Search
          </AppText>
          <AppText variant="caption" color={palette.muted}>
            Indexed privately on this device
          </AppText>
        </View>
        <View style={[styles.lockBadge, { backgroundColor: palette.mintSoft }]}>
          <Feather name="lock" size={12} color={palette.mint} />
        </View>
      </View>
      <View
        style={[
          styles.searchBox,
          { backgroundColor: palette.surface, borderColor: query ? palette.accent : palette.border },
        ]}
      >
        <Feather name="search" size={17} color={query ? palette.accent : palette.faint} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search senders, subjects, words…"
          placeholderTextColor={palette.faint}
          selectionColor={palette.accent}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{
            flex: 1,
            color: palette.ink,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            paddingVertical: spacing.md,
          }}
        />
        {query ? (
          <Touchable onPress={() => setQuery("")} haptic="light" accessibilityLabel="Clear search">
            <Feather name="x-circle" size={16} color={palette.faint} />
          </Touchable>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {filters.map((entry) => (
          <Chip
            key={entry.key}
            label={entry.label}
            selected={filter === entry.key}
            onPress={() => setFilter(entry.key)}
          />
        ))}
        <Touchable
          onPress={() => setUnreadOnly((value) => !value)}
          haptic="light"
          style={[
            styles.unreadChip,
            {
              backgroundColor: unreadOnly ? palette.accentSoft : "transparent",
              borderColor: unreadOnly ? palette.accent : palette.border,
            },
          ]}
        >
          <View
            style={[
              styles.unreadDot,
              { backgroundColor: unreadOnly ? palette.accent : palette.borderStrong },
            ]}
          />
          <AppText
            variant="caption"
            weight="medium"
            color={unreadOnly ? palette.accentStrong : palette.muted}
          >
            Unread
          </AppText>
        </Touchable>
      </View>
      {loading ? (
        <View
          style={[
            styles.indexing,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <ActivityIndicator size="small" color={palette.accent} />
            <View style={{ flex: 1 }}>
              <AppText variant="caption" weight="medium">
                Decrypting your search index
              </AppText>
              <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                {progress}% · happens only on this phone
              </AppText>
            </View>
            <AppText variant="caption" color={palette.accentStrong} weight="semibold">
              {progress}%
            </AppText>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: palette.surfaceRaised }]}>
            <View
              style={[
                styles.progressBar,
                { backgroundColor: palette.accent, width: `${Math.max(3, progress)}%` },
              ]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      {header}

      {error ? (
        <ErrorState message={error} onRetry={() => void loadIndex()} />
      ) : loading && index.length === 0 ? (
        <View style={{ padding: spacing.xl, gap: spacing.lg }}>
          {[0, 1, 2, 3, 4].map((row) => (
            <View
              key={row}
              style={[
                styles.skeletonRow,
                { backgroundColor: palette.surface, borderColor: palette.borderSoft },
              ]}
            >
              <Skeleton width={40} height={40} radiusSize={20} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="38%" height={10} />
                <Skeleton width="72%" height={11} />
                <Skeleton width="54%" height={9} />
              </View>
            </View>
          ))}
        </View>
      ) : query.trim() && results.length === 0 ? (
        <EmptyState
          icon="search"
          title="No matches"
          description={`Nothing matched “${query.trim()}”. Try a sender, a subject, or fewer words.`}
        />
      ) : !query.trim() ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon="shield"
            title="Private search"
            description={
              index.length > 0
                ? `${index.length} messages are decrypted and indexed locally. The server never sees what you type.`
                : "Your mailbox is decrypted and indexed on this device only. Search by sender, subject or any word."
            }
            actionLabel={index.length === 0 && !loading ? "Build search index" : undefined}
            onAction={() => void loadIndex()}
          />
          {index.length > 0 ? (
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
              <AppText variant="micro" color={palette.faint}>
                Recent conversations
              </AppText>
              {Array.from(
                index
                  .filter((message) => message.folderType !== "DRAFTS")
                  .reduce((map, message) => {
                    if (!map.has(message.threadId)) map.set(message.threadId, message);
                    return map;
                  }, new Map<string, IndexedMessage>())
                  .values(),
              )
                .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
                .slice(0, 4)
                .map((message) => (
                  <Touchable
                    key={message.threadId}
                    onPress={() => setQuery(message.fromName || message.fromAddress.split("@")[0])}
                    haptic="light"
                    style={[
                      styles.recent,
                      { backgroundColor: palette.surface, borderColor: palette.borderSoft },
                    ]}
                  >
                    <Avatar name={message.fromName} email={message.fromAddress} size={30} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <AppText variant="caption" weight="medium" color={palette.inkSoft} numberOfLines={1}>
                        {message.subject}
                      </AppText>
                      <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                        {message.fromName || message.fromAddress}
                      </AppText>
                    </View>
                    <Feather name="search" size={12} color={palette.faint} />
                  </Touchable>
                ))}
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 120, paddingTop: spacing.lg }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.md }}>
              <AppText variant="micro" color={palette.faint}>
                {results.length} result{results.length === 1 ? "" : "s"}
              </AppText>
            </View>
          }
          renderItem={({ item }) => (
            <Touchable
              onPress={() =>
                navigation.navigate("Thread", {
                  id: item.threadId,
                  folderType: item.folderType,
                  subject: item.subject,
                })
              }
              haptic="light"
              style={[
                styles.result,
                { backgroundColor: palette.surface, borderColor: palette.borderSoft },
              ]}
            >
              <Avatar name={item.fromName} email={item.fromAddress} size={40} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <AppText variant="caption" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                    {item.fromName || item.fromAddress}
                  </AppText>
                  <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                    {new Date(item.sentAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </AppText>
                </View>
                <Highlight
                  text={item.subject}
                  query={deferredQuery}
                  color={palette.accentStrong}
                  muted={palette.inkSoft}
                />
                <Highlight
                  text={snippetFor(item)}
                  query={deferredQuery}
                  color={palette.accentStrong}
                  muted={palette.faint}
                />
              </View>
              <View style={[styles.folderBadge, { backgroundColor: palette.surfaceRaised }]}>
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 7.5 }}>
                  {item.folderType.toLowerCase()}
                </AppText>
              </View>
            </Touchable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lockBadge: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBox: {
    height: 50,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  unreadChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  unreadDot: { width: 6, height: 6, borderRadius: 3 },
  indexing: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.md,
  },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressBar: { height: 4, borderRadius: 2 },
  skeletonRow: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  result: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: 7,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  folderBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
  },
});
