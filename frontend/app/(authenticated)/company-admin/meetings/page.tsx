import type { Metadata } from 'next';

import { MeetingsAdminSettingsClient } from './MeetingsAdminSettingsClient';

export const metadata: Metadata = {
  title: 'Админка компании — Встречи',
};

/**
 * `/company-admin/meetings` — настройки Org для встреч (ТЗ 2026-06-02).
 *
 * Содержит блок управления списком типов встреч, для которых НЕ
 * рассчитывается AI-оценка качества (`Org.qualityScoreDisabledForTypes`).
 *
 * Доступ: owner / admin Org. Backend защищает `/api/v1/org/settings/quality-score`,
 * клиент показывает 403 как empty-state.
 */
export default function CompanyAdminMeetingsPage() {
  return <MeetingsAdminSettingsClient />;
}
