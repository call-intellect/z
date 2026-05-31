'use client';

import { Sparkles } from 'lucide-react';

/**
 * MarketingHero — заголовок и обещание ценности для партнёрской программы Коры.
 *
 * Текст — ТЗ 2026-05-31-referrals-cabinet-revamp §9, вариант 3 (финальный).
 * Никакого английского; «оплата клиента» вместо `paid`; явная экономика
 * в цифрах (5 клиентов = 100 000 ₽ и т.д.).
 *
 * Показывается во всех трёх состояниях кабинета (A/B/C) — это якорь
 * страницы. В состояниях B/C — компактный (`compact=true`), без блока
 * примеров с цифрами (он уже исполнил роль мотиватора при создании ссылки).
 */
export function MarketingHero({ compact = false }: { compact?: boolean }) {
  return (
    <header className="space-y-3">
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent"
          aria-hidden="true"
        >
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Партнёрская программа Коры
          </h1>
          {!compact && (
            <p className="mt-2 text-base text-fg-primary">
              Приводи бизнес — получай 20 000 ₽ в месяц с каждого. Платим за
              каждого активного клиента, ежемесячно, пока он пользуется Корой.
            </p>
          )}
        </div>
      </div>

      {!compact && (
        <ul className="ml-13 space-y-1.5 pl-13 text-sm text-fg-secondary">
          <li className="flex items-baseline gap-2">
            <span className="text-accent">•</span>
            <span>
              5 клиентов → <strong className="text-fg-primary">100 000 ₽</strong>{' '}
              в месяц
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="text-accent">•</span>
            <span>
              20 клиентов →{' '}
              <strong className="text-fg-primary">400 000 ₽</strong> в месяц
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="text-accent">•</span>
            <span>
              Без потолка и без срока — пока клиент с нами, ты получаешь
            </span>
          </li>
        </ul>
      )}
    </header>
  );
}
