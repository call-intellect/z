import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Интеграции — Z',
};

/**
 * Старый путь `/integrations` сохраняется для совместимости с закладками
 * пользователей и старыми ссылками в письмах. Перенаправляем на новый
 * подраздел в настройках, где живёт реальный UI destinations.
 */
export default function IntegrationsRedirect() {
  redirect('/settings/integrations');
}
