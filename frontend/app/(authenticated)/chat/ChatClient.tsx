'use client';

import { MessageCircle } from 'lucide-react';

import { OrgChatPanel } from '@/ui/components/chat/OrgChatPanel';
import { TierGate } from '@/ui/components/TierGate';

/**
 * `/chat` — единый AI-чат поверх ядра знаний (org-scope).
 *
 * Тонкая обёртка над общим `<OrgChatPanel>` (Фаза 8 шаг 5) с историей.
 * Та же панель встроена в дашборд директора (`/dashboard`) с
 * `withHistory={false}` — там короткий ad-hoc Q&A, без длинного журнала.
 *
 * Тариф-гейтинг: org-scope чат — это `feature.chat_org` (Фаза 12).
 * На tier_basic показываем `<TierGate>`-заглушку с CTA на /settings/billing.
 * Если в будущем добавим другие scope'ы (например, /chat?scope=meeting) —
 * gating переедет внутрь логики, как описано в плане.
 *
 * Бэкенд переключается между ChatV2 и legacy через ENV `CHAT_V2_ENABLED`.
 * Логика graceful fallback (503 chat_v2_disabled → legacy) живёт внутри
 * `<OrgChatPanel>`.
 */
export function ChatClient() {
  return (
    <TierGate feature="feature.chat_org">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6">
        <header className="mb-4 flex items-center gap-2">
          <MessageCircle size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold">Помощник компании</h1>
            <p className="text-sm text-fg-tertiary">
              Задайте вопрос по всему архиву встреч и знаний организации. Кора
              подбирает релевантные блоки и отвечает с цитатами.
            </p>
          </div>
        </header>

        {/* SBA α-5: баннер про новую версию /chat-v2. */}
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <MessageCircle size={16} className="mt-0.5 text-accent shrink-0" />
            <div>
              <span className="font-medium text-fg-primary">
                Доступна новая версия чата
              </span>
              <span className="ml-1 text-fg-secondary">
                — с историей диалогов, закреплением, доступом через Telegram/email и
                цитатами из источников.
              </span>{' '}
              <a
                href="/chat-v2"
                className="font-medium text-accent underline hover:no-underline"
              >
                Попробовать /chat-v2
              </a>
            </div>
          </div>
        </div>

        <OrgChatPanel className="flex-1 min-h-[500px]" withHistory />
      </div>
    </TierGate>
  );
}
