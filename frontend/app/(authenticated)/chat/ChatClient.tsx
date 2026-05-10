'use client';

import { MessageCircle } from 'lucide-react';

import { OrgChatPanel } from '@/ui/components/chat/OrgChatPanel';

/**
 * `/chat` — единый AI-чат поверх ядра знаний (org-scope).
 *
 * Тонкая обёртка над общим `<OrgChatPanel>` (Фаза 8 шаг 5) с историей.
 * Та же панель встроена в дашборд директора (`/dashboard`) с
 * `withHistory={false}` — там короткий ad-hoc Q&A, без длинного журнала.
 *
 * Бэкенд переключается между ChatV2 и legacy через ENV `CHAT_V2_ENABLED`.
 * Логика graceful fallback (503 chat_v2_disabled → legacy) живёт внутри
 * `<OrgChatPanel>`.
 */
export function ChatClient() {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6">
      <header className="mb-4 flex items-center gap-2">
        <MessageCircle size={20} className="text-accent" />
        <div>
          <h1 className="text-2xl font-semibold">AI-чат</h1>
          <p className="text-sm text-fg-tertiary">
            Задайте вопрос по всему архиву встреч и знаний организации. AI
            подбирает релевантные блоки и отвечает с цитатами.
          </p>
        </div>
      </header>

      <OrgChatPanel className="flex-1 min-h-[500px]" withHistory />
    </div>
  );
}
