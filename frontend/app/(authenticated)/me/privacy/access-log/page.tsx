import type { Metadata } from 'next';

import { AccessLogClient } from './AccessLogClient';

export const metadata: Metadata = {
  title: 'Приватность · история просмотров',
};

/**
 * `/me/privacy/access-log` — Pulse Wave 4 §4.2.
 *
 * Сотрудник видит «кто и когда открывал мою карточку»: запись
 * `KnowledgeAccessLog` собирается `KnowledgeAccessLoggerInterceptor`
 * на `PersonsController` (`/api/v1/persons/:id/{pulse|knowledge-profile|...}`).
 *
 * Self-views (когда я сам открываю свою карточку) не пишутся —
 * фильтр в интерцепторе.
 */
export default function MyPrivacyAccessLogPage() {
  return <AccessLogClient />;
}
