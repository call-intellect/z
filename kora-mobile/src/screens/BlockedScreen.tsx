import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { accountApi, type BlockedMemberApi } from "@/api/account.api";
import { ApiError } from "@/api/error";
import { EmptyState, ErrorState, Loader } from "@/components/StatusViews";
import { colors, spacing } from "@/theme/theme";

export function BlockedScreen() {
  const [items, setItems] = useState<BlockedMemberApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await accountApi.listBlocked();
        if (active) setItems(res.items);
      } catch (e) {
        if (active)
          setError(
            e instanceof ApiError ? e.message : "Не удалось загрузить список",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <Loader />;
  if (error) return <ErrorState message={error} />;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Никто не заблокирован"
        hint="Заблокировать можно из переписки"
      />
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(i) => `${i.conversationId}:${i.userId}`}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.name}>{item.name}</Text>
        </View>
      )}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  name: { color: colors.text, fontSize: 15 },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
});
