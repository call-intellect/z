import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EmptyState, ErrorState, Loader } from "@/components/StatusViews";
import { ThreadRow } from "@/components/ThreadRow";
import type { InboxSort, InboxThreadType } from "@/api/threads.api";
import type { InboxThread } from "@/domain/messaging";
import { useThreads } from "@/hooks/useThreads";
import { colors, radius, spacing } from "@/theme/theme";

const FILTERS: { key: InboxThreadType; label: string }[] = [
  { key: "all", label: "Всё" },
  { key: "dm", label: "Личные" },
  { key: "group", label: "Группы" },
  { key: "work_chat", label: "Задачи" },
  { key: "external", label: "Клиенты" },
  { key: "unread", label: "Непрочит." },
];

export function MessagesScreen() {
  const router = useRouter();
  const [type, setType] = useState<InboxThreadType>("all");
  const [sort] = useState<InboxSort>("recent");
  const [q, setQ] = useState("");
  const { threads, loading, error, reload } = useThreads(type, sort, q);

  const openThread = (thread: InboxThread) => {
    if (thread.kind === "work_chat" && thread.linkedIssue) {
      router.push({
        pathname: "/chat/[id]",
        params: {
          id: thread.refId,
          title: thread.title,
          kind: thread.kind,
          issueId: thread.linkedIssue.id,
        },
      });
      return;
    }
    router.push({
      pathname: "/chat/[id]",
      params: { id: thread.refId, title: thread.title, kind: thread.kind },
    });
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={reload}
        placeholder="Поиск по людям, группам, задачам"
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
      />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={type === f.key}
            onPress={() => setType(f.key)}
          />
        ))}
      </View>
      {loading && threads.length === 0 ? (
        <Loader label="Загрузка ленты" />
      ) : error ? (
        <ErrorState message={error} />
      ) : threads.length === 0 ? (
        <EmptyState title="Пока пусто" hint="Здесь появится вся переписка" />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.refId}
          renderItem={({ item }) => (
            <ThreadRow thread={item} onPress={openThread} />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={reload}
              tintColor={colors.accent}
            />
          }
        />
      )}
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Text
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: {
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontSize: 15,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  chip: {
    color: colors.textMuted,
    fontSize: 13,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  chipActive: { color: "#fff", backgroundColor: colors.accent },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 72,
  },
});
