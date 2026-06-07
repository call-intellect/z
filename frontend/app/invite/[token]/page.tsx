import type { Metadata } from 'next';

import { AcceptInviteMagicClient } from './AcceptInviteMagicClient';

export const metadata: Metadata = {
  title: 'Приглашение в компанию',
};

/**
 * β-9 — публичная страница приёма приглашения по magic-link.
 *
 * Сценарий: сотрудник кликает по ссылке `/invite/<magicToken>` из письма
 * (или из ссылки, которую переслал руководитель в Telegram). Без auth.
 * Клиент дёргает `POST /api/v1/accounts/invitations/accept-magic` — бэкенд
 * создаёт User, Membership, открывает сессию (выставляет cookie `z_session`).
 *
 * НЕ путать с авторизованным `/invitations/[token]` — там legacy-flow для
 * уже залогиненных пользователей (acceptInvitation по обычному token).
 */
export default async function AcceptInviteMagicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AcceptInviteMagicClient magicToken={token} />;
}
