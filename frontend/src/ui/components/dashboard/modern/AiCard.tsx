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
        background:
          'radial-gradient(120% 100% at 50% 0%, oklch(0.4 0.18 295 / 0.55), oklch(0.2 0.04 280 / 0.5))',
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
        style={{ background: GRAD.violet, boxShadow: '0 12px 30px -10px oklch(0.6 0.2 300 / 0.9)' }}
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
          style={{ background: 'oklch(1 0 0 / 0.92)', color: 'oklch(0.2 0.04 285)' }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
