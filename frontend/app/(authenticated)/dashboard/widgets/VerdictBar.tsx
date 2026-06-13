'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

import { CHART } from '@/ui/components/dashboard/modern';

/**
 * VerdictBar (ТЗ Ф8.2 cabinet-redesign — экран «Сегодня»).
 *
 * Строка-вердикт дня. Управление-по-исключению (Databox management-by-exception):
 * дашборд «молчит при норме» — при отсутствии сбоя показываем спокойный зелёный
 * вердикт, без тревоги.
 *
 * Два режима:
 *   - `tone='ok'`   — сбор данных работает. «Компания в норме. N вещей требуют
 *     вашего решения» (N = requiresAction.total). При N=0 — «всё спокойно».
 *   - `tone='down'` — сбор данных не работает (degraded из ответа или сбой
 *     загрузки). Красный вердикт без чисел требований, кнопка ведёт в /actions.
 *
 * Парные цветовые токены: зелёный — мята (CHART.mint), красный — CHART.red.
 * Никаких сырых hex/text-white — цвета из палитры графиков `modern/tokens`.
 */

type Props = {
  /** requiresAction.total — сколько решений в очереди (только при tone='ok'). */
  requiresCount: number;
  /** true — сбор данных не работает (degraded ответа или сбой загрузки). */
  down: boolean;
  /** Доп. подпись справа от LED (последняя встреча / причина сбоя). */
  subtitle?: string | null;
};

function pluralThings(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'вещь требует';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return 'вещи требуют';
  return 'вещей требуют';
}

export function VerdictBar({ requiresCount, down, subtitle }: Props) {
  const isDown = down;
  const tone = isDown ? CHART.red : CHART.mint;
  const toneBg = isDown
    ? 'oklch(0.66 0.22 25 / 0.16)'
    : 'oklch(0.85 0.15 165 / 0.14)';

  const headline = isDown
    ? 'Сбор данных не работает — показатели ниже могут быть неполными'
    : requiresCount > 0
      ? `Компания в норме. ${requiresCount} ${pluralThings(
          requiresCount,
        )} вашего решения`
      : 'Компания в норме. Ничего срочного — можно выдохнуть';

  return (
    <div
      className="flex items-center gap-3 rounded-2xl p-4"
      style={{
        background:
          'linear-gradient(180deg, oklch(0.3 0.035 280 / 0.55), oklch(0.22 0.03 278 / 0.5))',
        border: `1px solid ${isDown ? 'oklch(0.66 0.22 25 / 0.35)' : 'oklch(1 0 0 / 0.08)'}`,
        backdropFilter: 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
      }}
      role="status"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
        style={{ background: toneBg, color: tone }}
        aria-hidden
      >
        {isDown ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-sm font-semibold"
          style={{ color: isDown ? tone : CHART.text }}
        >
          {headline}
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate text-xs" style={{ color: CHART.faint }}>
            {subtitle}
          </div>
        )}
      </div>
      {(isDown || requiresCount > 0) && (
        <Link
          href="/actions"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-transform hover:translate-x-0.5"
          style={{
            background: isDown ? 'oklch(0.66 0.22 25 / 0.18)' : 'oklch(1 0 0 / 0.08)',
            color: isDown ? tone : CHART.text,
          }}
        >
          Разобрать
          <ArrowRight size={15} />
        </Link>
      )}
    </div>
  );
}
