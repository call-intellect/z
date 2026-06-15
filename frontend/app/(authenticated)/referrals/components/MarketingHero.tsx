'use client';

import { Sparkles } from 'lucide-react';

import { GRAD, glass } from '@/ui/components/dashboard/modern';

/**
 * MarketingHero — заголовок и обещание ценности для партнёрской программы Коры.
 *
 * Текст — ТЗ 2026-05-31-referrals-cabinet-revamp §9, вариант 3 (финальный).
 * Никакого английского; «оплата клиента» вместо `paid`; явная экономика
 * в цифрах (5 клиентов = 100 000 ₽ и т.д.). Копи СОХРАНЕНА дословно.
 *
 * Редизайн (B9, modern): градиент-герой на «стеклянной» подложке с фиолетовым
 * свечением, крупный заголовок, плавающие плашки-примеры с цифрами.
 *
 * Показывается во всех трёх состояниях кабинета (A/B/C) — это якорь
 * страницы. В состояниях B/C — компактный (`compact=true`), без блока
 * примеров с цифрами (он уже исполнил роль мотиватора при создании ссылки).
 */
export function MarketingHero({ compact = false }: { compact?: boolean }) {
  return (
    <header
      style={glass()}
      className="relative overflow-hidden p-6 sm:p-8"
    >
      {/* мягкое фиолетовое свечение в правом-верхнем углу */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl"
        style={{ background: 'oklch(0.66 0.2 300 / 0.35)' }}
      />

      <div className="relative flex items-start gap-4">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-lg"
          style={{ background: GRAD.violet, color: 'oklch(0.99 0.005 280)' }}
          aria-hidden="true"
        >
          <Sparkles className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary sm:text-3xl">
            Партнёрская программа Коры
          </h1>
          {!compact && (
            <p className="mt-2 max-w-2xl text-base text-fg-secondary">
              Приводи бизнес — получай 20 000 ₽ в месяц с каждого. Платим за
              каждого активного клиента, ежемесячно, пока он пользуется Корой.
            </p>
          )}
        </div>
      </div>

      {!compact && (
        <div className="relative mt-6 flex flex-wrap gap-3">
          <ExampleChip grad={GRAD.teal} lead="5 клиентов" value="100 000 ₽" tail="в месяц" />
          <ExampleChip grad={GRAD.blue} lead="20 клиентов" value="400 000 ₽" tail="в месяц" />
          <div
            style={glass({ borderRadius: 16 })}
            className="flex items-center gap-2 px-4 py-3 text-sm text-fg-secondary"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: 'oklch(0.84 0.16 80)' }}
              aria-hidden="true"
            />
            Без потолка и без срока — пока клиент с нами, ты получаешь
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * Плавающая плашка-пример с экономикой: «N клиентов → СУММА в месяц».
 * Градиентная подложка иконки-точки + крупная сумма.
 */
function ExampleChip({
  grad,
  lead,
  value,
  tail,
}: {
  grad: string;
  lead: string;
  value: string;
  tail: string;
}) {
  return (
    <div
      style={glass({ borderRadius: 16 })}
      className="flex items-center gap-3 px-4 py-3"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-semibold"
        style={{ background: grad, color: 'oklch(0.99 0.005 280)' }}
        aria-hidden="true"
      >
        →
      </span>
      <div className="leading-tight">
        <div className="text-xs text-fg-tertiary">{lead}</div>
        <div className="text-lg font-semibold text-fg-primary">
          {value}{' '}
          <span className="text-xs font-normal text-fg-tertiary">{tail}</span>
        </div>
      </div>
    </div>
  );
}
