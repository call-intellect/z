import type { Metadata } from 'next';

import { FeedClient } from './FeedClient';

export const metadata: Metadata = {
  title: 'Лента Коры',
};

/**
 * «Лента Коры» — `/feed` (ТЗ редизайн кабинета 2026-06-13, Ф8.6).
 *
 * Живая лента-новости компании с анализом: идеи, сигналы, блокеры, решения,
 * конфликты, активность + вопросы Коры и вопросы людей. Переключатель типов +
 * контроль вопросов Коры (кто ответил / молчит / не видел / протух — owner/
 * admin/coo). Поверх:
 *   - GET  /api/v1/feed/cora?type=&window=&limit=
 *   - POST /api/v1/feed/cora/seen
 *   - GET  /api/v1/probe/control?window=&limit=
 *
 * Вход — из хаба «Память» (`/memory` → «Лента Коры»).
 */
export default function FeedPage() {
  return <FeedClient />;
}
