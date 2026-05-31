import { redirect } from 'next/navigation';

/**
 * `/admin/integrations/keys` — redirect на существующий
 * `/admin/integration-keys`. Маршрут вкатан в новый сайдбар «Каналы и
 * интеграции», старый путь сохранён для обратной совместимости.
 */
export default function AdminIntegrationsKeysRedirect(): never {
  redirect('/admin/integration-keys');
}
