/**
 * Legacy URL `/admin/ai-usage` (Фаза 9 редизайна).
 *
 * Раздел переехал в новую информационную архитектуру — теперь это
 * `/admin/analytics/functions` (категория «Аналитика»). Сам компонент
 * `AiUsageDashboard` уже не используется напрямую; всё, что нужно,
 * есть в `/admin/analytics/*`.
 *
 * Мы оставляем эту страницу как 308-redirect, чтобы:
 *   - сохранить старые ссылки в чужих местах (закладки, письма, документация);
 *   - не ломать deep-links из второго мозга и из истории сессий.
 *
 * Пункт сайдбара «AI-вызовы (legacy)» удалён из `navigation.ts` —
 * новый трафик сюда ходить не должен.
 */

import { permanentRedirect } from 'next/navigation';

export default function AdminAiUsageLegacyPage(): never {
  permanentRedirect('/admin/analytics/functions');
}
