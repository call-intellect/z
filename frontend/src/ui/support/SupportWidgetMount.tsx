'use client';

import { useSupportStatus } from '@/hooks/useSupportStatus';
import { SupportWidget } from './SupportWidget';

/**
 * SupportWidgetMount — гейт показа плавающего виджета поддержки.
 *
 * Рендерит `<SupportWidget />` только когда деск настроен
 * (`useSupportStatus().deskEnabled`). Если поддержка не сконфигурирована
 * (нет вендор-Org / флаг выключен) — ничего не показываем, чтобы не вводить
 * пользователя в заблуждение неработающей кнопкой.
 */
export function SupportWidgetMount() {
  const { deskEnabled } = useSupportStatus();
  if (!deskEnabled) return null;
  return <SupportWidget />;
}
