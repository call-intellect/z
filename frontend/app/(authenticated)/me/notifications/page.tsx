import type { Metadata } from 'next';

import { NotificationsClient } from './NotificationsClient';

export const metadata: Metadata = {
  title: 'Уведомления — Кора',
};

/**
 * `/me/notifications` — центр уведомлений: probe-вопросы от Коры,
 * карточки на модерацию, системные сообщения. Master-detail: список +
 * детальная карточка с inline-кнопками «Ответить», «Пропустить».
 */
export default function MeNotificationsPage() {
  return <NotificationsClient />;
}
