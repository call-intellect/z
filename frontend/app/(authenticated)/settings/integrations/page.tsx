import { redirect } from 'next/navigation';

/**
 * Старый адрес `/settings/integrations` переехал в самостоятельный раздел
 * `/delivery` (outbound-доставка + импорт), т.к. это не настройка и не
 * подключение источников. Редиректим, чтобы старые ссылки/закладки работали.
 */
export default function SettingsIntegrationsRedirect() {
  redirect('/delivery');
}
