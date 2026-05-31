'use client';

import Link from 'next/link';
import { AlertOctagon } from 'lucide-react';

import type { PulsePatternIrreversibleDecisionDomain } from '@/domain/pulse-patterns';

/**
 * IrreversibleDecisionsAlert (Pulse Wave 6 §6.8) — Banner-стиль.
 *
 * Показывается ТОЛЬКО если есть type-1 (необратимые) решения без
 * рассмотренных альтернатив. Без них компонент возвращает null
 * (не загромождаем главную при отсутствии алертов).
 */

type Props = {
  decisions: PulsePatternIrreversibleDecisionDomain[];
  alertCount: number;
};

export function IrreversibleDecisionsAlert({ decisions, alertCount }: Props) {
  if (alertCount === 0) return null;

  // Алерт — только без альтернатив.
  const flagged = decisions.filter((d) => !d.hasAlternatives);
  if (flagged.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-chip-danger-fg/40 bg-chip-danger-bg/30 p-4 shadow-card-soft">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-chip-danger-fg">
        <AlertOctagon size={18} />
        {alertCount} необратимых{' '}
        {alertCount === 1
          ? 'решение'
          : alertCount < 5
            ? 'решения'
            : 'решений'}{' '}
        без рассмотренных альтернатив
      </div>
      <p className="mb-3 text-xs text-fg-secondary">
        Type-1 (двери в одну сторону) — стоит зафиксировать альтернативы,
        чтобы решение можно было защитить позже.
      </p>
      <ul className="space-y-1.5">
        {flagged.slice(0, 5).map((d) => (
          <li key={d.decisionId}>
            <Link
              href={`/decisions/${encodeURIComponent(d.decisionId)}`}
              className="block rounded-md bg-bg-card/60 p-2 text-sm hover:bg-bg-card"
            >
              <p className="line-clamp-2 text-fg-primary">
                {d.statement || 'Без формулировки'}
              </p>
              <p className="mt-0.5 text-xs text-fg-tertiary">
                {d.decidedAt.toLocaleDateString('ru', {
                  day: '2-digit',
                  month: 'short',
                })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
