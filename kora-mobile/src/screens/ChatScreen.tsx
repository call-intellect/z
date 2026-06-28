import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Composer, type ComposerAccess } from "@/components/Composer";
import { MessageBubble } from "@/components/MessageBubble";
import { ErrorState, Loader } from "@/components/StatusViews";
import { threadsApi } from "@/api/threads.api";
import type { ChatMessage, ConversationKind } from "@/domain/messaging";
import { useConversation } from "@/hooks/useConversation";
import { colors, spacing } from "@/theme/theme";

interface Props {
  conversationId: string;
  kind: ConversationKind;
  issueId?: string;
}

export function ChatScreen({ conversationId, kind, issueId }: Props) {
  const router = useRouter();
  const { messages, loading, error, userId, send } =
    useConversation(conversationId);
  const [access, setAccess] = useState<ComposerAccess>(
    kind === "ticket" ? "external" : "normal",
  );

  const onLongPress = useCallback(
    (message: ChatMessage) => {
      if (message.authorUserId === userId) return;
      Alert.alert("Сообщение", "Действие с сообщением", [
        {
          text: "Пожаловаться",
          style: "destructive",
          onPress: () => {
            void threadsApi
              .reportMessage(message.id)
              .then(() => Alert.alert("Жалоба отправлена"))
              .catch(() => Alert.alert("Не удалось отправить жалобу"));
          },
        },
        {
          text: "Заблокировать автора",
          style: "destructive",
          onPress: () => {
            void threadsApi
              .blockMember(conversationId, message.authorUserId)
              .then(() => Alert.alert("Пользователь заблокирован"))
              .catch(() => Alert.alert("Не удалось заблокировать"));
          },
        },
        { text: "Отмена", style: "cancel" },
      ]);
    },
    [conversationId, userId],
  );

  const handleSend = useCallback(
    (text: string) => {
      void send(text, kind === "ticket" ? access : undefined).catch(() => {
        Alert.alert("Ошибка", "Не удалось отправить сообщение");
      });
    },
    [send, kind, access],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {issueId ? (
        <Pressable
          style={styles.issueBar}
          onPress={() =>
            router.push({ pathname: "/issue/[id]", params: { id: issueId } })
          }
        >
          <Text style={styles.issueBarText}>Открыть карточку задачи →</Text>
        </Pressable>
      ) : null}
      {loading && messages.length === 0 ? (
        <Loader label="Загрузка переписки" />
      ) : error && messages.length === 0 ? (
        <ErrorState message={error} />
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isOwn={item.authorUserId === userId}
              sourceKind={kind}
              onLongPress={onLongPress}
            />
          )}
          contentContainerStyle={styles.list}
        />
      )}
      <Composer
        onSend={handleSend}
        supportMode={kind === "ticket"}
        access={access}
        onAccessChange={setAccess}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingVertical: spacing.sm },
  issueBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  issueBarText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
});
