import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { kindLabel, type InboxThread } from "@/domain/messaging";
import { colors, radius, spacing } from "@/theme/theme";

interface Props {
  thread: InboxThread;
  onPress: (thread: InboxThread) => void;
}

function relativeTime(date: Date | null): string {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "сейчас";
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} д`;
}

export function ThreadRow({ thread, onPress }: Props) {
  return (
    <Pressable style={styles.row} onPress={() => onPress(thread)}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {thread.title.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {thread.linkedIssue
              ? `${thread.linkedIssue.identifier} · ${thread.title}`
              : thread.title}
          </Text>
          <Text style={styles.time}>{relativeTime(thread.lastMessageAt)}</Text>
        </View>
        <View style={styles.subRow}>
          <Text style={styles.snippet} numberOfLines={1}>
            {thread.snippet || kindLabel(thread.kind)}
          </Text>
          {thread.slaBreached ? (
            <View style={styles.slaBadge}>
              <Text style={styles.slaText}>SLA</Text>
            </View>
          ) : null}
          {thread.hasUnread ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  body: { flex: 1, gap: 4 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  time: { color: colors.textMuted, fontSize: 12 },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  snippet: { color: colors.textMuted, fontSize: 13, flex: 1 },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  slaBadge: {
    paddingHorizontal: 6,
    height: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  slaText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
