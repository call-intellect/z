import type { Metadata } from 'next';

import { MyDailyBriefClient } from './MyDailyBriefClient';

export const metadata: Metadata = {
  title: 'Твой день',
};

/**
 * `/me/daily-brief` (ТЗ 2026-06-11 mobile-cora-exec-manager, Ф0) — целевая
 * страница утреннего push-крона `actionUrl:'/me/daily-brief'`. Читает
 * существующий `GET /api/v1/me/daily-brief` (self-scope), отмечает бриф
 * открытым. Раньше маршрут не существовал → push вёл в никуда.
 */
export default function MyDailyBriefPage() {
  return <MyDailyBriefClient />;
}
