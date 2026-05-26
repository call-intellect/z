import type { Metadata } from 'next';

import { CloneChatClient } from './CloneChatClient';

export const metadata: Metadata = {
  title: 'Диалог с клоном — Кора',
};

/**
 * `/clones/[roleId]/chat/[conversationId]` (ТЗ 2026-05-26 §3.8) —
 * чат пользователя с ролевым клоном внутри конкретного диалога.
 *
 * Layout: sidebar диалогов слева (sticky на desktop / drawer на mobile)
 * + основной поток сообщений с composer'ом.
 *
 * Доступ требует активный `CloneAccessGrant`. Если grant отозван
 * mid-session — клиент редиректит на `/clones/[roleId]` с тостом.
 */
export default function CloneChatPage({
  params,
}: {
  params: { roleId: string; conversationId: string };
}) {
  return (
    <CloneChatClient
      roleId={params.roleId}
      conversationId={params.conversationId}
    />
  );
}
