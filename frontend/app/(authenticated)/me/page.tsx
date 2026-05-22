import type { Metadata } from 'next';

import { MeClient } from './MeClient';

export const metadata: Metadata = {
  title: 'Я — Z',
};

/**
 * `/me` — личный кабинет сотрудника (минимальный вид Фазы 0c).
 *
 * Состав: шапка (имя, должность, отдел), карта моей должности (превью
 * RoleProfile или статус «формируется»), мои документы, мои встречи.
 *
 * Для manager (== member) это страница по умолчанию вместо /dashboard.
 */
export default function MePage() {
  return <MeClient />;
}
