'use client';

import Link from 'next/link';

import { getCompanyStageLabel } from '@/lib/cause-category-presentation';
import type { MaturitySnapshotDomain } from '@/domain/operations-dashboard';

/**
 * SBA β-8.3 Wave 3 — виджет «Зрелость компании» на COO-дашборде.
 *
 * Источник данных — `OperationsOverviewDomain.maturity` (см.
 * `frontend/src/domain/operations-dashboard.ts`).
 *
 * Состояния:
 *   - `score=null` (cron ещё не отработал) — карточка-заглушка с подсказкой.
 *   - `score=number` — кольцо + stage + две колонки доменов + ссылка на /maturity.
 *
 * Кольцо нарисовано чистым SVG (без сторонних библиотек), цвет accent —
 * mint accent токен дизайн-системы Z (резервный hex — для случаев, когда
 * Tailwind-токен в SVG-stroke не работает).
 */
export function MaturityWidget(props: { maturity: MaturitySnapshotDomain }) {
  const { maturity } = props;

  if (maturity.score === null) {
    return (
      <section className="rounded border border-border-subtle bg-bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg-primary">
            Зрелость компании
          </h2>
          <Link
            href="/maturity"
            className="text-xs text-accent hover:underline"
          >
            Подробнее →
          </Link>
        </div>
        <p className="rounded border border-border-subtle bg-bg-overlay p-3 text-sm text-fg-secondary">
          Расчёт зрелости — каждое утро в 05:00 UTC. Проверьте позже.
        </p>
      </section>
    );
  }

  const percent = maturity.scorePercent ?? 0;
  const stageLabel = getCompanyStageLabel(maturity.stage);

  return (
    <section className="rounded border border-border-subtle bg-bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg-primary">
          Зрелость компании
        </h2>
        <Link href="/maturity" className="text-xs text-accent hover:underline">
          Подробнее →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center justify-center">
          <ScoreRing percent={percent} />
          <div className="mt-2 text-center">
            <div className="text-xs uppercase tracking-wide text-fg-tertiary">
              Стадия
            </div>
            <div className="text-sm font-medium text-fg-primary">
              {stageLabel}
            </div>
            {maturity.lastCalcAt ? (
              <div className="mt-1 text-[10px] text-fg-tertiary">
                обновлено{' '}
                {maturity.lastCalcAt.toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DomainList
            title="Слабые места"
            items={maturity.weakestDomains}
            tone="danger"
          />
          <DomainList
            title="Сильные стороны"
            items={maturity.topDomains}
            tone="success"
          />
        </div>
      </div>
    </section>
  );
}

function ScoreRing({ percent }: { percent: number }) {
  // SVG-кольцо. Радиус 36, толщина 8, размер 88×88.
  const size = 88;
  const radius = 36;
  const stroke = 8;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Зрелость компании ${clamped}%`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        className="text-bg-overlay"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#5EEAD4"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-fg-primary text-xl font-bold"
      >
        {clamped}%
      </text>
    </svg>
  );
}

function DomainList(props: {
  title: string;
  items: Array<{ slug: string; name: string; completenessPercent: number }>;
  tone: 'danger' | 'success';
}) {
  const dotClass =
    props.tone === 'danger'
      ? 'bg-rose-500'
      : 'bg-emerald-500';
  return (
    <div>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-fg-tertiary">
        {props.title}
      </h3>
      {props.items.length === 0 ? (
        <p className="text-xs text-fg-tertiary">Нет данных</p>
      ) : (
        <ul className="space-y-1.5">
          {props.items.slice(0, 3).map((d) => (
            <li
              key={d.slug}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass}`}
                  aria-hidden
                />
                <span className="truncate text-fg-primary">{d.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-xs text-fg-tertiary">
                {d.completenessPercent}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
