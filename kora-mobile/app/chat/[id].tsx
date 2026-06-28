import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";

import { ChatScreen } from "@/screens/ChatScreen";
import type { ConversationKind } from "@/domain/messaging";

const KINDS: ConversationKind[] = [
  "dm",
  "group",
  "channel",
  "work_chat",
  "external",
  "ticket",
];

function parseKind(raw: string | string[] | undefined): ConversationKind {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && (KINDS as string[]).includes(value)
    ? (value as ConversationKind)
    : "dm";
}

function parseString(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export default function ChatRoute() {
  const params = useLocalSearchParams<{
    id: string;
    title?: string;
    kind?: string;
    issueId?: string;
  }>();

  const conversationId = parseString(params.id) ?? "";
  const title = parseString(params.title) ?? "Чат";
  const kind = parseKind(params.kind);
  const issueId = parseString(params.issueId);

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ChatScreen
        conversationId={conversationId}
        kind={kind}
        {...(issueId ? { issueId } : {})}
      />
    </>
  );
}
