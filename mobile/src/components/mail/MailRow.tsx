import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import type { MailListItem } from "../../hooks/useMailList";
import { previewOf } from "../../hooks/useMailList";
import { displaySender, formatRelativeTime, truncate } from "../../lib/format";
import { AppText } from "../ui/AppText";
import { Avatar } from "../ui/Avatar";
import { Touchable } from "../ui/Touchable";

interface MailRowProps {
  item: MailListItem;
  onPress: () => void;
  onLongPress: () => void;
  onToggleStar: () => void;
  selected?: boolean;
  selectionMode?: boolean;
}

export function MailRow({
  item,
  onPress,
  onLongPress,
  onToggleStar,
  selected,
  selectionMode,
}: MailRowProps) {
  const palette = usePalette();
  const { thread, decrypted } = item;
  const message = thread.latest;
  const unread = thread.unreadCount > 0 || (!message.isRead && thread.messageCount <= 1);
  const preview = previewOf(item);
  const sender = displaySender(message.fromName, message.fromAddress);
  const isDraft = message.isDraft;
  const labels = thread.labels.slice(0, 3);
  const hasAttachment = message.attachments.length > 0 || Boolean(decrypted?.body.attachments.length);
  const starScale = useRef(new Animated.Value(1)).current;
  const dotPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!message.isStarred) return;
    Animated.sequence([
      Animated.spring(starScale, {
        toValue: 1.45,
        useNativeDriver: true,
        damping: 7,
        stiffness: 300,
      }),
      Animated.spring(starScale, {
        toValue: 1,
        useNativeDriver: true,
        damping: 10,
        stiffness: 260,
      }),
    ]).start();
  }, [message.isStarred, starScale]);

  useEffect(() => {
    if (!unread) {
      dotPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, {
          toValue: 0.35,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(dotPulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dotPulse, unread]);

  const popStar = () => {
    Animated.sequence([
      Animated.timing(starScale, { toValue: 0.7, duration: 80, useNativeDriver: true }),
      Animated.spring(starScale, {
        toValue: 1,
        useNativeDriver: true,
        damping: 8,
        stiffness: 300,
      }),
    ]).start();
    onToggleStar();
  };

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      haptic="none"
      style={[
        styles.card,
        {
          backgroundColor: selected
            ? palette.accentSoft
            : unread
              ? palette.surface
              : palette.mode === "dark"
                ? "rgba(17,19,26,0.55)"
                : "rgba(255,255,255,0.62)",
          borderColor: selected ? palette.accent : unread ? palette.border : palette.borderSoft,
        },
      ]}
      accessibilityLabel={`${unread ? "Unread" : "Read"} message from ${sender}: ${preview.subject}`}
    >
      {selectionMode ? (
        <View
          style={[
            styles.checkbox,
            {
              borderColor: selected ? palette.accent : palette.borderStrong,
              backgroundColor: selected ? palette.accent : "transparent",
            },
          ]}
        >
          {selected ? <Feather name="check" size={13} color="#FFFFFF" /> : null}
        </View>
      ) : (
        <View style={styles.avatarWrap}>
          <Avatar name={message.fromName} email={message.fromAddress} size={44} />
          {unread ? (
            <Animated.View
              style={[
                styles.unreadDot,
                {
                  backgroundColor: palette.accent,
                  borderColor: palette.surface,
                  opacity: dotPulse,
                },
              ]}
            />
          ) : null}
        </View>
      )}

      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.topLine}>
          <AppText
            variant="small"
            weight={unread ? "semibold" : "medium"}
            color={unread ? palette.ink : palette.inkSoft}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {isDraft ? `Draft to ${message.toAddresses.map((a) => a.email).join(", ") || "…"}` : sender}
          </AppText>
          {labels.length > 0 ? (
            <View style={styles.labels}>
              {labels.map((label) => (
                <View
                  key={label.id}
                  style={[styles.labelDot, { backgroundColor: label.color }]}
                />
              ))}
            </View>
          ) : null}
          <AppText
            variant="micro"
            color={unread ? palette.accentStrong : palette.faint}
            style={{ fontSize: 9.5, letterSpacing: 0 }}
          >
            {formatRelativeTime(message.sentAt)}
          </AppText>
        </View>

        <View style={styles.subjectLine}>
          {unread && !selectionMode ? (
            <View style={[styles.subjectDot, { backgroundColor: palette.accent }]} />
          ) : null}
          <AppText
            variant="small"
            weight={unread ? "semibold" : "regular"}
            color={unread ? palette.ink : palette.inkSoft}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {preview.subject}
          </AppText>
          {hasAttachment ? (
            <Feather name="paperclip" size={12} color={palette.faint} />
          ) : null}
          {thread.messageCount > 1 ? (
            <View style={[styles.countPill, { backgroundColor: palette.surfaceRaised }]}>
              <AppText variant="micro" color={palette.muted} style={{ fontSize: 8.5, letterSpacing: 0 }}>
                {thread.messageCount}
              </AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.bottomLine}>
          <AppText variant="caption" color={palette.faint} numberOfLines={1} style={{ flex: 1 }}>
            {truncate(preview.snippet, 84)}
          </AppText>
          {!selectionMode ? (
            <Touchable
              onPress={popStar}
              haptic="light"
              accessibilityLabel={message.isStarred ? "Unstar conversation" : "Star conversation"}
              style={styles.starButton}
            >
              <Animated.View style={{ transform: [{ scale: starScale }] }}>
                <Feather
                  name="star"
                  size={14}
                  color={message.isStarred ? palette.star : palette.borderStrong}
                  style={message.isStarred ? { opacity: 1 } : { opacity: 0.9 }}
                />
              </Animated.View>
            </Touchable>
          ) : null}
        </View>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md + 2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    marginBottom: 7,
  },
  avatarWrap: { position: "relative" },
  unreadDot: {
    position: "absolute",
    right: -1,
    top: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  topLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  subjectLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  subjectDot: { width: 5, height: 5, borderRadius: 3 },
  bottomLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 1 },
  labels: { flexDirection: "row", gap: 3 },
  labelDot: { width: 6, height: 6, borderRadius: 3 },
  starButton: { paddingLeft: 4, paddingVertical: 2 },
  countPill: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
