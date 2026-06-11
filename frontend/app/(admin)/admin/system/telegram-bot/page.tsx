import type { Metadata } from 'next';

import { TelegramBotClient } from './TelegramBotClient';

export const metadata: Metadata = { title: 'Telegram-бот' };

export default function TelegramBotPage() {
  return <TelegramBotClient />;
}
