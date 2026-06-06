import type { Metadata } from 'next';

import { CloneDetailClient } from './CloneDetailClient';

export const metadata: Metadata = {
  title: 'Клон должности — Кора',
};

/**
 * `/clones/[roleId]` (ТЗ 2026-05-26 §2) — карточка клона должности.
 *
 * Содержит шапку, top traits, сотрудников на роли и список моих диалогов
 * с этим клоном. Кнопка «+ Новый диалог» создаёт ChatV2Conversation
 * через `POST /api/v1/clones/roles/:roleId/conversations` и переходит в
 * `/clones/[roleId]/chat/[conversationId]`.
 *
 * Заменяет канонический URL клона — старый `/roles/[id]/clone` теперь
 * 301-редиректит сюда.
 */
export default async function CloneDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return <CloneDetailClient roleId={roleId} />;
}
