"use client";

import { MasterScopedChat } from "@/ui/chat/MasterScopedChat";

export interface IssueChatProps {
  issueId: string;
  orgId: string;
}

export function IssueChat({ issueId, orgId }: IssueChatProps) {
  return (
    <MasterScopedChat
      scope="issue"
      scopeRefId={issueId}
      orgId={orgId}
      enableVoice
      enableTts
      placeholder="Спросить Кору про эту задачу…"
      emptyTitle="Спросите Кору про эту задачу"
      emptyHint="Кора подтянет контекст из памяти компании и ответит со ссылками на источники."
    />
  );
}
