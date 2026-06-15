'use client';

import { Sparkles } from 'lucide-react';

import { GRAD, glass } from './tokens';
import { CHART } from './tokens';

/**
 * Карточка AI-сводки со свечением: радиальный фиолетовый фон, размытый блик в
 * углу, крупная иконка, заголовок, текст и опциональная CTA-кнопка.
 * Разметка и стили 1-в-1 из витрины (`AiCard`).
 */
export function AiCard({
  title,
  text,
  ctaLabel,
  onCta,
}: {
  title: string;
  text: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div
      style={glass({
        // Тема-зависимый фиолетовый тон AI-карточки: подложка из стеклянной
        // поверхности (flip по теме) + лавандовый chip-тон поверх (тёмная:
        // насыщенный приглушённый, светлая: пастельный) — смысл «AI/фиолет»
        // сохранён в обеих темах, без тёмного-на-светлом.
        background:
          'linear-gradient(180deg, var(--chip-lavender-bg), transparent), var(--glass-surface)',
      })}
      className="relative overflow-hidden p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl"
        style={{ background: 'oklch(0.6 0.2 300 / 0.45)' }}
      />
      <div
        className="grid h-14 w-14 place-items-center rounded-2xl"
        style={{
          background: GRAD.violet,
          boxShadow: '0 12px 30px -10px oklch(0.6 0.2 300 / 0.9)',
          // Иконка на насыщенном фиолетовом градиенте читается светлой в обеих
          // темах (иначе в светлой теме унаследует тёмный текст — низкий контраст).
          color: 'oklch(0.99 0 0)',
        }}
      >
        <Sparkles size={24} />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: CHART.dim }}>
        {text}
      </p>
      {ctaLabel && (
        <button
          type="button"
          onClick={onCta}
          className="mt-4 w-full rounded-xl py-2.5 text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
