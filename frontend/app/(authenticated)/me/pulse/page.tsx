import type { Metadata } from 'next';

import { MyPulseClient } from './MyPulseClient';

export const metadata: Metadata = { title: 'Мой пульс — Кора' };

/**
 * `/me/pulse` — личная Pulse-карточка сотрудника (pulse-full Волна 3).
 *
 * Сам сотрудник смотрит свой пульс: резолвим свой `personId` через
 * `GET /me/profile` и переиспользуем существующий `PersonPulseClient`
 * (backend RBAC разрешает self-view: `Person.userId === currentUser.id`).
 */
export default function MyPulsePage() {
  return <MyPulseClient />;
}
