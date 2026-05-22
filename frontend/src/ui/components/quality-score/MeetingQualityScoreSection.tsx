'use client';

/**
 * Секция «Оценка качества встречи» (Фаза C §8.1).
 *
 * Источник: plans/tz/2026-05-21-phase-C-meeting-quality-score.md §8.
 *
 * Видна только хосту встречи (`Meeting.ownerId === currentUserId`) и
 * Org-Admin'у. Гости / non-host members — backend возвращает 403, UI
 * показывает их как ошибку доступа (компонент сам скрывается).
 *
 * Состояния:
 *   - disabled → ничего не рендерим (секции нет).
 *   - pending  → skeleton.
 *   - failed   → empty-state + кнопка «Перезапустить оценку».
 *   - ready    → большой балл (цвет по уровню) + 5 категорий + рекомендации + strengths.
 *
 * Все строки русские (memory `feedback_admin_ui_russian_only`).
 */

import { useState } from 'react';

import { qualityScoreApi } from '@/api/quality-score.api';
import {
  qualityScoreCategoryLabel,
  qualityScoreColor,
  qualityScoreSeverityLabel,
  type QualityScoreCategoriesDomain,
  type QualityScoreCategory,
  type QualityScoreDomain,
  type QualityScoreRecommendationDomain,
  type QualityScoreSeverity,
} from '@/domain/quality-score';
import { useMeetingQualityScore } from '@/hooks/use-meeting-quality-score';

export interface MeetingQualityScoreSectionProps {
  meetingId: string;
  /**
   * Скрывать ли секцию полностью, если зритель не хост (родитель уже
   * проверил по `Meeting.ownerId === currentUserId` ИЛИ нет org-admin
   * прав). По умолчанию рендерим — фронт верит RBAC бэка и обрабатывает
   * 403 как visibilty='hidden'.
   */
  visible?: boolean;
}

export function MeetingQualityScoreSection({
  meetingId,
  visible = true,
}: MeetingQualityScoreSectionProps) {
  const { data, error, isLoading, mutate } = useMeetingQualityScore(meetingId);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  if (!visible) return null;
  if (isLoading && !data) return <PendingSkeleton />;

  // 403 / not authorised → секция скрывается.
  if (error && hasStatus403(error)) return null;
  if (error) return <ErrorBox onRetry={() => mutate()} />;
  if (!data) return <PendingSkeleton />;

  if (data.status === 'disabled') return null;
  if (data.status === 'pending') return <PendingSkeleton />;
  if (data.status === 'failed') {
    return (
      <FailedBox
        onRetry={async () => {
          setRegenError(null);
          setRegenerating(true);
          try {
            await qualityScoreApi.regenerate(meetingId);
            mutate();
          } catch (e) {
            setRegenError(humanError(e));
          } finally {
            setRegenerating(false);
          }
        }}
        busy={regenerating}
        error={regenError}
      />
    );
  }

  if (!data.score) return <PendingSkeleton />;
  const score = data.score;

  return (
    <section
      data-testid="meeting-quality-score-section"
      className="rounded-2xl border border-neutral-200 bg-white p-6 space-y-5"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Оценка качества встречи</h2>
          <p className="text-xs text-neutral-500">
            Видна только организатору и администраторам организации.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            setRegenError(null);
            setRegenerating(true);
            try {
              await qualityScoreApi.regenerate(meetingId);
              mutate();
            } catch (e) {
              setRegenError(humanError(e));
            } finally {
              setRegenerating(false);
            }
          }}
          disabled={regenerating}
          title="Можно вызывать не чаще 3 раз в час"
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {regenerating ? 'Перезапуск…' : 'Перезапустить оценку'}
        </button>
      </header>

      {regenError ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {regenError}
        </div>
      ) : null}

      {score.degradedMode ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Оценка построена на локальной модели — точность может быть ниже обычной.
        </div>
      ) : null}

      <OverallScoreBlock value={score.overallScore} />
      <CategoriesBlock categories={score.categories} />
      <RecommendationsBlock recommendations={score.recommendations} />
      <StrengthsBlock strengths={score.strengths} />
    </section>
  );
}

// ─────────────────────── inner views ───────────────────────

function OverallScoreBlock({ value }: { value: number }) {
  const color = qualityScoreColor(value);
  const colorClass =
    color === 'red'
      ? 'text-red-700 bg-red-50 border-red-200'
      : color === 'yellow'
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : 'text-emerald-700 bg-emerald-50 border-emerald-200';
  return (
    <div className={`flex items-center gap-4 rounded-xl border p-4 ${colorClass}`}>
      <div className="text-5xl font-bold tabular-nums">{value}</div>
      <div className="text-sm">
        <div className="font-semibold">Общий балл</div>
        <div className="text-xs opacity-80">из 100</div>
      </div>
    </div>
  );
}

function CategoriesBlock({
  categories,
}: {
  categories: QualityScoreCategoriesDomain;
}) {
  const order: QualityScoreCategory[] = [
    'preparation',
    'structure',
    'clarity',
    'outcomes',
    'engagement',
  ];
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-neutral-800">Категории</div>
      <div className="space-y-2">
        {order.map((cat) => {
          const v = categories[cat];
          const color = qualityScoreColor(v);
          const barColor =
            color === 'red' ? 'bg-red-500' : color === 'yellow' ? 'bg-amber-400' : 'bg-emerald-500';
          return (
            <div key={cat}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-700">{qualityScoreCategoryLabel(cat)}</span>
                <span className="font-medium tabular-nums text-neutral-900">{v}</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full ${barColor}`}
                  style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationsBlock({
  recommendations,
}: {
  recommendations: QualityScoreRecommendationDomain[];
}) {
  if (recommendations.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-neutral-800">Рекомендации</div>
      <ul className="space-y-2">
        {recommendations.map((r, idx) => (
          <li
            key={`${r.category}-${idx}`}
            className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
          >
            <SeverityIcon severity={r.severity} />
            <div className="text-sm">
              <div className="text-neutral-900">{r.text}</div>
              <div className="text-xs text-neutral-500">
                {qualityScoreCategoryLabel(r.category)} ·{' '}
                {qualityScoreSeverityLabel(r.severity)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StrengthsBlock({ strengths }: { strengths: string[] }) {
  if (strengths.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-neutral-800">Что было хорошо</div>
      <ul className="space-y-1">
        {strengths.map((s, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900"
          >
            <span aria-hidden>✓</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: QualityScoreSeverity }) {
  const map: Record<QualityScoreSeverity, { label: string; cls: string }> = {
    info: { label: 'i', cls: 'bg-neutral-200 text-neutral-700' },
    warning: { label: '!', cls: 'bg-amber-200 text-amber-800' },
    critical: { label: '!', cls: 'bg-red-200 text-red-800' },
  };
  const { label, cls } = map[severity];
  return (
    <span
      aria-hidden
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${cls}`}
    >
      {label}
    </span>
  );
}

// ─────────────────────── states ───────────────────────

function PendingSkeleton() {
  return (
    <section
      data-testid="meeting-quality-score-section-loading"
      className="rounded-2xl border border-neutral-200 bg-white p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-neutral-900">Оценка качества встречи</h2>
      <p className="text-sm text-neutral-500">Считаем AI-оценку. Обычно занимает 1–2 минуты.</p>
      <div className="h-20 animate-pulse rounded-lg bg-neutral-100" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
    </section>
  );
}

function FailedBox({
  onRetry,
  busy,
  error,
}: {
  onRetry: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <section
      data-testid="meeting-quality-score-section-failed"
      className="rounded-2xl border border-red-200 bg-red-50 p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-red-800">Оценка качества встречи</h2>
      <p className="text-sm text-red-700">Не удалось рассчитать. Попробуйте перезапустить.</p>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? 'Перезапуск…' : 'Перезапустить оценку'}
      </button>
    </section>
  );
}

function ErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      data-testid="meeting-quality-score-section-error"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-amber-900">Оценка качества встречи</h2>
      <p className="text-sm text-amber-800">Ошибка загрузки. Попробуйте обновить.</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
      >
        Обновить
      </button>
    </section>
  );
}

// ─────────────────────── helpers ───────────────────────

function hasStatus403(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && (code === 'http_403' || code === 'forbidden')) {
    return true;
  }
  const status = (err as { status?: unknown }).status;
  return status === 403;
}

function humanError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Не удалось перезапустить оценку.';
  const code = (err as { code?: unknown }).code;
  if (code === 'rate_limit_exceeded' || code === 'http_429') {
    return 'Превышен лимит регенерации: 3 раза в час.';
  }
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message : 'Не удалось перезапустить оценку.';
}
