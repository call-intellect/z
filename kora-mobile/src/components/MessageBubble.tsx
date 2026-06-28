import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ChatMessage, ConversationKind } from "@/domain/messaging";
import { colors, radius, spacing } from "@/theme/theme";

interface Props {
  message: ChatMessage;
  isOwn: boolean;
  sourceKind: ConversationKind;
  onLongPress?: (message: ChatMessage) => void;
}

function accessTint(access: ChatMessage["access"]): string | null {
  if (access === "internal") return colors.internalNote;
  if (access === "external") return colors.externalReply;
  return null;
}

function timeLabel(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function MessageBubble({ message, isOwn, onLongPress }: Props) {
  if (message.isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{message.content}</Text>
      </View>
    );
  }

  const tint = accessTint(message.access);
  const bubbleStyle = [
    styles.bubble,
    isOwn ? styles.bubbleOwn : styles.bubbleOther,
    tint ? { backgroundColor: tint } : null,
  ];

  return (
    <Pressable
      onLongPress={() => onLongPress?.(message)}
      style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}
    >
      <View style={bubbleStyle}>
        {message.authorType === "clone" ? (
          <Text style={styles.cloneTag}>Черновик Коры</Text>
        ) : null}
        {message.access === "internal" ? (
          <Text style={styles.accessTag}>Заметка команды</Text>
        ) : null}
        {message.voiceUrl ? (
          <Text style={styles.voice}>
            Голосовое{" "}
            {message.voiceDuration ? `· ${message.voiceDuration}с` : ""}
          </Text>
        ) : null}
        {message.content ? (
          <Text style={styles.content}>{message.content}</Text>
        ) : null}
        <Text style={styles.meta}>
          {timeLabel(message.createdAt)}
          {message.isEdited ? " · изм." : ""}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.md,
    marginVertical: spacing.xs,
    flexDirection: "row",
  },
  rowOwn: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "82%",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  bubbleOwn: { backgroundColor: colors.accentMuted },
  bubbleOther: { backgroundColor: colors.surfaceAlt },
  content: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    alignSelf: "flex-end",
    marginTop: 2,
  },
  cloneTag: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: "600",
  },
  accessTag: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: "600",
  },
  voice: {
    color: colors.accent,
    fontSize: 13,
  },
  systemRow: {
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  systemText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
  },
});
