import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/api/error";
import { supportApi } from "@/api/support.api";
import { EmptyState, ErrorState, Loader } from "@/components/StatusViews";
import { useAuth } from "@/context/AuthContext";
import {
  statusLabel,
  supportTicketFromApi,
  type SupportTicket,
} from "@/domain/support";
import { colors, radius, spacing } from "@/theme/theme";

export function SupportScreen() {
  const router = useRouter();
  const { canSeeSupport } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = canSeeSupport
        ? await supportApi.deskTickets()
        : await supportApi.myTickets();
      setTickets(res.items.map(supportTicketFromApi));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Не удалось загрузить обращения",
      );
    } finally {
      setLoading(false);
    }
  }, [canSeeSupport]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loader label="Загрузка обращений" />;
  if (error) return <ErrorState message={error} />;
  if (tickets.length === 0) {
    return <EmptyState title="Обращений нет" hint="Здесь будут тикеты" />;
  }

  return (
    <FlatList
      style={styles.container}
      data={tickets}
      keyExtractor={(t) => t.conversationId}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            router.push({
              pathname: "/chat/[id]",
              params: {
                id: item.conversationId,
                title: item.subject,
                kind: "ticket",
              },
            })
          }
        >
          <View style={styles.rowHead}>
            <Text style={styles.subject} numberOfLines={1}>
              {item.subject}
            </Text>
            {item.slaBreached ? (
              <View style={styles.sla}>
                <Text style={styles.slaText}>SLA</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.status}>{statusLabel(item.status)}</Text>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 4 },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  subject: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  status: { color: colors.textMuted, fontSize: 13 },
  sla: {
    paddingHorizontal: 6,
    height: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  slaText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
});
