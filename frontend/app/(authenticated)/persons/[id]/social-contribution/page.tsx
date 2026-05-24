import type { Metadata } from 'next';

import { PersonSocialContributionClient } from './PersonSocialContributionClient';

export const metadata: Metadata = {
  title: 'Вклад в команду — Кора',
};

/**
 * `/persons/[id]/social-contribution` (Specialist 3.8) — публичный профиль
 * социального вклада другого человека (read-only).
 *
 * Доступ: сам пользователь + admin/owner + руководитель команды (RBAC
 * `social_contribution_profile.read`). На бэке возвращаются только public
 * traits (5 позитивных типов) — никаких question_unanswered.
 *
 * Если у текущего пользователя нет прав — бэк отдаёт 403, мы показываем
 * empty/forbidden состояние.
 */
export default function PersonSocialContributionPage({
  params,
}: {
  params: { id: string };
}) {
  return <PersonSocialContributionClient personId={params.id} />;
}
