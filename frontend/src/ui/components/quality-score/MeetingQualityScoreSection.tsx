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
      className="rounded-2xl border border-border-subtle bg-bg-card p-6 space-y-5"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg-primary">Оценка качества встречи</h2>
          <p className="text-xs text-fg-secondary">
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
          className="rounded-lg border border-border bg-bg-card px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          {regenerating ? 'Перезапуск…' : 'Перезапустить оценку'}
        </button>
      </header>

      {regenError ? (
        <div className="rounded-lg bg-chip-warning-bg px-3 py-2 text-sm text-chip-warning-fg">
          {regenError}
        </div>
      ) : null}

      {score.degradedMode ? (
        <div className="rounded-lg bg-chip-warning-bg px-3 py-2 text-xs text-chip-warning-fg">
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
      ? 'text-chip-danger-fg bg-chip-danger-bg border-chip-danger-bg'
      : color === 'yellow'
        ? 'text-chip-warning-fg bg-chip-warning-bg border-chip-warning-bg'
        : 'text-chip-success-fg bg-chip-success-bg border-chip-success-bg';
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
      <div className="text-sm font-medium text-fg-primary">Категории</div>
      <div className="space-y-2">
        {order.map((cat) => {
          const v = categories[cat];
          const color = qualityScoreColor(v);
          const barColor =
            color === 'red' ? 'bg-danger' : color === 'yellow' ? 'bg-warning' : 'bg-success';
          return (
            <div key={cat}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-secondary">{qualityScoreCategoryLabel(cat)}</span>
                <span className="font-medium tabular-nums text-fg-primary">{v}</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
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
      <div className="text-sm font-medium text-fg-primary">Рекомендации</div>
      <ul className="space-y-2">
        {recommendations.map((r, idx) => (
          <li
            key={`${r.category}-${idx}`}
            className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-subtle p-3"
          >
            <SeverityIcon severity={r.severity} />
            <div className="text-sm">
              <div className="text-fg-primary">{r.text}</div>
              <div className="text-xs text-fg-secondary">
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
      <div className="text-sm font-medium text-fg-primary">Что было хорошо</div>
      <ul className="space-y-1">
        {strengths.map((s, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 rounded-lg bg-chip-success-bg p-2 text-sm text-chip-success-fg"
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
    info: { label: 'i', cls: 'bg-bg-overlay text-fg-secondary' },
    warning: { label: '!', cls: 'bg-chip-warning-bg text-chip-warning-fg' },
    critical: { label: '!', cls: 'bg-chip-danger-bg text-chip-danger-fg' },
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
      className="rounded-2xl border border-border-subtle bg-bg-card p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-fg-primary">Оценка качества встречи</h2>
      <p className="text-sm text-fg-secondary">Считаем оценку качества. Обычно занимает 1–2 минуты.</p>
      <div className="h-20 animate-pulse rounded-lg bg-bg-subtle" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-bg-subtle" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-bg-subtle" />
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
      className="rounded-2xl border border-chip-danger-bg bg-chip-danger-bg p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-chip-danger-fg">Оценка качества встречи</h2>
      <p className="text-sm text-chip-danger-fg">Не удалось рассчитать. Попробуйте перезапустить.</p>
      {error ? <p className="text-xs text-chip-danger-fg">{error}</p> : null}
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-danger-fg hover:opacity-90 disabled:opacity-50"
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
      className="rounded-2xl border border-chip-warning-bg bg-chip-warning-bg p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-chip-warning-fg">Оценка качества встречи</h2>
      <p className="text-sm text-chip-warning-fg">Ошибка загрузки. Попробуйте обновить.</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-warning px-3 py-2 text-sm font-medium text-warning-fg hover:opacity-90"
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
