import type { Metadata } from 'next';

import { ChannelsClient } from './ChannelsClient';

export const metadata: Metadata = {
  title: 'Мои каналы',
};

/**
 * `/me/channels` — настройка каналов общения с Корой:
 * подключение Telegram/MAX (β-1), управление режимом «тихие часы»,
 * отвязка каналов. В α-1 виден только канал «В личном кабинете»;
 * генерация кодов привязки готова заранее под β-1.
 */
export default function MeChannelsPage() {
  return <ChannelsClient />;
}
