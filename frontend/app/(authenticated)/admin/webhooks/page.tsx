import { redirect } from 'next/navigation';

/**
 * `/admin/webhooks` — старый URL. После Фазы 6 редизайна (2026-05-25) этот
 * раздел переехал под `/admin/integrations/webhooks`. Здесь — redirect, чтобы
 * закладки/ссылки продолжали работать.
 *
 * Сам клиент `AdminWebhooksClient` остаётся в этой же папке — он реиспользуется
 * вкладкой «Активные» из `WebhooksIntegrationsClient`.
 */
export default function LegacyAdminWebhooksRedirect(): never {
  redirect('/admin/integrations/webhooks');
}
