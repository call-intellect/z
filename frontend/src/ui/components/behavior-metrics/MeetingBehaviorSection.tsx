'use client';

/**
 * Секция «Поведение участников» на странице результата встречи (Фаза B §9.1).
 *
 * Состояния (ТЗ B §9.1):
 *   - pending → skeleton с подписью «Метрики считаются…».
 *   - failed → empty-state «Не удалось рассчитать» + кнопка обновить.
 *   - low_confidence → готовые метрики + badge о низкой точности.
 *   - ready → готовые метрики.
 *
 * Все строки на русском (memory `feedback_admin_ui_russian_only`).
 */

import { useMeetingBehaviorMetrics } from '@/hooks/use-meeting-behavior-metrics';
import type {
  BehaviorMetricsDomain,
  BehaviorParticipantDomain,
} from '@/domain/behavior-metrics';

export interface MeetingBehaviorSectionProps {
  meetingId: string;
}

export function MeetingBehaviorSection({ meetingId }: MeetingBehaviorSectionProps): JSX.Element {
  const { data, error, isLoading, mutate } = useMeetingBehaviorMetrics(meetingId);

  if (isLoading && !data) return <PendingSkeleton />;
  if (error) return <ErrorBox onRetry={mutate} />;
  if (!data) return <PendingSkeleton />;

  if (data.status === 'pending') return <PendingSkeleton />;
  if (data.status === 'failed') return <FailedBox onRetry={mutate} />;
  // ready или low_confidence — рендерим метрики.

  const lowConfidence = data.status === 'low_confidence' || data.meeting?.lowConfidence === true;
  return (
    <section
      data-testid="meeting-behavior-section"
      className="rounded-2xl border border-neutral-200 bg-white p-6 space-y-4"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">Поведение участников</h2>
        {lowConfidence ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-800">
            Метрики ориентировочные: качество диаризации низкое
          </span>
        ) : null}
      </header>

      <MeetingMetricsCards data={data} />
      <ParticipantsBar participants={data.participants} />
      <ParticipantsTable participants={data.participants} />
    </section>
  );
}

// ───────────────────────── states ─────────────────────────

function PendingSkeleton(): JSX.Element {
  return (
    <section
      data-testid="meeting-behavior-section-loading"
      className="rounded-2xl border border-neutral-200 bg-white p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-neutral-900">Поведение участников</h2>
      <p className="text-sm text-neutral-500">Метрики считаются. Это занимает обычно 1–2 минуты.</p>
      <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
    </section>
  );
}

function FailedBox({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <section
      data-testid="meeting-behavior-section-failed"
      className="rounded-2xl border border-red-200 bg-red-50 p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-red-800">Поведение участников</h2>
      <p className="text-sm text-red-700">Метрики не удалось рассчитать.</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Обновить
      </button>
    </section>
  );
}

function ErrorBox({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <section
      data-testid="meeting-behavior-section-error"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-amber-900">Поведение участников</h2>
      <p className="text-sm text-amber-800">Ошибка загрузки метрик. Попробуйте обновить.</p>
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

// ───────────────────────── inner views ─────────────────────────

function MeetingMetricsCards({ data }: { data: BehaviorMetricsDomain }): JSX.Element {
  if (!data.meeting) return <></>;
  const m = data.meeting;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <MetricCard title="Всего речи" value={formatMsToMinutes(m.totalSpeechMs)} />
      <MetricCard title="Тишина" value={`${m.silencePercent.toFixed(0)} %`} />
      <MetricCard title="Перекрёстная речь" value={formatMsToMinutes(m.crossTalkMs)} />
      <MetricCard
        title="Индекс доминирования"
        value={m.dominanceIndex >= 999 ? '—' : m.dominanceIndex.toFixed(1)}
      />
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="text-xs text-neutral-500">{title}</div>
      <div className="mt-1 text-lg font-semibold text-neutral-900">{value}</div>
    </div>
  );
}

function ParticipantsBar({
  participants,
}: {
  participants: BehaviorParticipantDomain[];
}): JSX.Element {
  if (participants.length === 0) return <></>;
  const total =
    participants.reduce((sum, p) => sum + p.speakingTimePercent, 0) || 1;
  return (
    <div data-testid="participants-bar" className="space-y-1">
      <div className="text-sm font-medium text-neutral-800">Доля времени говорения</div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100">
        {participants.map((p, idx) => (
          <div
            key={p.participantId ?? `g-${idx}`}
            className="h-full"
            style={{
              width: `${(p.speakingTimePercent / total) * 100}%`,
              backgroundColor: colourForIndex(idx),
            }}
            title={`${p.displayName}: ${p.speakingTimePercent.toFixed(1)} %`}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantsTable({
  participants,
}: {
  participants: BehaviorParticipantDomain[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="px-2 py-2">Участник</th>
            <th className="px-2 py-2">Время</th>
            <th className="px-2 py-2">% времени</th>
            <th className="px-2 py-2">Перевороты речи</th>
            <th className="px-2 py-2">Монологи</th>
            <th className="px-2 py-2">Самый длинный монолог</th>
            <th className="px-2 py-2">Вопросы</th>
            <th className="px-2 py-2">Слова-паразиты</th>
            <th className="px-2 py-2">Прерывания (сделано / получено)</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((p, idx) => (
            <tr key={p.participantId ?? `g-${idx}`} className="border-t border-neutral-100">
              <td className="px-2 py-2 font-medium text-neutral-900">
                {p.displayName}
                {p.isGuest ? (
                  <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                    Гость
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-2">{formatMsToMinutes(p.speakingTimeMs)}</td>
              <td className="px-2 py-2">{p.speakingTimePercent.toFixed(1)} %</td>
              <td className="px-2 py-2">{p.turnsCount}</td>
              <td className="px-2 py-2">{p.monologueCount}</td>
              <td className="px-2 py-2">{formatMsToMinutes(p.longestMonologueMs)}</td>
              <td className="px-2 py-2">{p.questionCount}</td>
              <td className="px-2 py-2">{p.fillerWordsCount}</td>
              <td className="px-2 py-2">
                {p.interruptionsMadeCount} / {p.interruptionsReceivedCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── utils ─────────────────────────

function formatMsToMinutes(ms: number): string {
  if (ms <= 0) return '0 с';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} с`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m} мин` : `${m} мин ${s} с`;
}

const COLOURS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9', '#8B5CF6'];
function colourForIndex(i: number): string {
  return COLOURS[i % COLOURS.length] ?? '#6366F1';
}
