import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@/theme/theme";

export function IssueScreen({ issueId }: { issueId: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Карточка задачи</Text>
      <Text style={styles.muted}>ID: {issueId}</Text>
      <Text style={styles.muted}>
        Журнал, файлы и прогресс задачи — доступны в десктоп-кабинете.
        Переписка ведётся в рабочем чате задачи.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
