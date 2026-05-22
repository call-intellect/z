import type { Metadata } from 'next';

import { MeetingsAdminSettingsClient } from './MeetingsAdminSettingsClient';

export const metadata: Metadata = {
  title: 'Админка организации — Встречи',
};

/**
 * `/settings/admin/meetings` — настройки Org для встреч (Фаза C §8.3).
 *
 * Сейчас содержит один блок — управление списком типов встреч, для которых
 * НЕ рассчитывается AI-оценка качества (`Org.qualityScoreDisabledForTypes`).
 *
 * Доступ: owner / admin Org. Backend защищает `/api/v1/org/settings/quality-score`,
 * клиент показывает 403 как empty-state.
 */
export default function SettingsAdminMeetingsPage() {
  return <MeetingsAdminSettingsClient />;
}
