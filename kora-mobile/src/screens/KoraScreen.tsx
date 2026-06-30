import React, { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError } from "@/api/error";
import { koraApi } from "@/api/kora.api";
import { Composer } from "@/components/Composer";
import { colors, radius, spacing } from "@/theme/theme";

interface Props {
  conversationId?: string;
}

export function KoraScreen({ conversationId }: Props) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [scope, setScope] = useState(conversationId ?? "");

  const ask = useCallback(
    async (question: string) => {
      if (!scope.trim()) {
        setError("Укажите conversationId для запроса к Коре");
        return;
      }
      setPending(true);
      setError(null);
      try {
        const res = await koraApi.ask(scope.trim(), question);
        setAnswer(res.answer);
        setSources(res.sourceMessageIds);
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : "Кора не смогла ответить",
        );
      } finally {
        setPending(false);
      }
    },
    [scope],
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Спросить Кору</Text>
        <Text style={styles.hint}>
          Кора отвечает на основе памяти компании со ссылками на сообщения.
        </Text>
        {!conversationId ? (
          <TextInput
            style={styles.scopeInput}
            value={scope}
            onChangeText={setScope}
            placeholder="conversationId"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
        ) : null}
        {pending ? <Text style={styles.hint}>Кора думает…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {answer ? (
          <View style={styles.answerCard}>
            <Text style={styles.answerText}>{answer}</Text>
            {sources.length > 0 ? (
              <Text style={styles.sources}>
                Источники: {sources.length} сообщ.
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <Composer onSend={ask} disabled={pending} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  hint: { color: colors.textMuted, fontSize: 13 },
  scopeInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 14 },
  answerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  answerText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  sources: { color: colors.textMuted, fontSize: 12 },
});
