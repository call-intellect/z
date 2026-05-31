import type { Metadata } from 'next';

import { PreferenceDatasetClient } from './PreferenceDatasetClient';

export const metadata: Metadata = {
  title: 'Preference dataset — Z-Admin',
};

/**
 * W2.3 KC-Temporal (2026-05-25) — `/admin/ai/preference-dataset`.
 *
 * Просмотр и скачивание `LlmPreferenceSample` — записей, которые куратор
 * пометил как `correct` / `wrong` / `misleading` через `CurationService`.
 * Используется для оффлайн-retraining'а few-shot'ов специалистов 3.x.
 *
 * Backend: `LlmPreferenceDatasetController` (admin модуль).
 */
export default function AdminPreferenceDatasetPage() {
  return <PreferenceDatasetClient />;
}
