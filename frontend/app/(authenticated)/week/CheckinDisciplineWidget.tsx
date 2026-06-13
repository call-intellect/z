'use client';

import { CalendarCheck } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import { useAuth } from '@/contexts/auth-context';
import {
  fromCheckinDisciplineApi,
  localDateString,
  type CheckinDisciplinePersonDomain,
} from '@/domain/checkin-discipline';
import { CardTitle, CHART, GlassCard, GRAD } from '@/ui/components/dashboard/modern';

/**
 * «Дисциплина чек-инов» (ТЗ редизайн кабинета Ф2 / Ф8.7) — вкладка «Кто держит
 * слово» на `/week`.
 *
 * Таблица по людям: сдано/пропущено утро·вечер за неделю
 * (`GET /dashboard/operations/checkin-discipline?from=<понедельник>&to=<сегодня>`).
 * Тон — «вернуть в ритм», НЕ рейтинг-штраф: CTA-чип «напомнить» (есть пропуски)
 * либо «в ритме» (всё сдано). Никаких процентов-наказаний.
 *
 * Б-6 — три состояния:
 *   - загрузка → «Загрузка…»;
 *   - ошибка → текст ошибки (forbidden → про роль);
 *   - `enabled=false` (флаг чек-инов OFF) → «Чек-ины выключены»;
 *   - нет людей → «—» / нейтральный empty-state.
 *
 * Инварианты: парные токены `chip-*` / палитра `modern`, весь текст по-русски,
 * без финансов.
 */
export function CheckinDisciplineWidget({ weekStart }: { weekStart: string }) {
  const { currentOrgId } = useAuth();
  // Окно: понедельник недели → сегодня (локальная дата). Если выбранная неделя
  // в прошлом, `to` всё равно «сегодня» — backend сам сузит окно по факту.
  const to = localDateString();
  const swrKey = currentOrgId
    ? ['checkin-discipline', currentOrgId, weekStart, to]
    : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    () =>
      operationsDashboardApi
        .getCheckinDiscipline(currentOrgId!, weekStart, to)
        .then(fromCheckinDisciplineApi),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const friendlyError = (() => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === 'forbidden') {
      return 'Нет доступа к дисциплине чек-инов (нужна роль coo / admin / owner).';
    }
    return error instanceof Error
      ? error.message
      : 'Не удалось загрузить дисциплину чек-инов.';
  })();

  return (
    <GlassCard>
      <CardTitle icon={<CalendarCheck size={16} />} grad={GRAD.teal}>
        Дисциплина чек-инов
      </CardTitle>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        Кто на этой неделе в ритме чек-инов, а кого стоит мягко вернуть. Это не
        оценка — подсказка, кому напомнить или чем помочь.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Загрузка…
        </p>
      ) : friendlyError ? (
        <p className="mt-4 text-sm" style={{ color: CHART.red }}>
          {friendlyError}
        </p>
      ) : !data ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          —
        </p>
      ) : !data.enabled ? (
        // Б-6 — флаг чек-инов выключен.
        <div
          className="mt-4 rounded-2xl p-6 text-center"
          style={{ background: 'oklch(1 0 0 / 0.04)' }}
        >
          <p className="text-sm font-medium" style={{ color: CHART.dim }}>
            Чек-ины выключены
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed" style={{ color: CHART.faint }}>
            Включите ежедневные чек-ины — и здесь появится дисциплина команды по
            утренним и вечерним ответам.
          </p>
        </div>
      ) : data.byPerson.length === 0 ? (
        // Б-6 — нет людей / нет ожидаемых чек-инов за окно.
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          За эту неделю ещё нет данных по чек-инам — они появятся по мере ответов
          команды.
        </p>
      ) : (
        <DisciplineTable rows={data.byPerson} />
      )}
    </GlassCard>
  );
}

/* ── Таблица по людям ─────────────────────────────────────────────────── */

function DisciplineTable({ rows }: { rows: CheckinDisciplinePersonDomain[] }) {
  // Сортируем: сначала те, у кого больше пропусков (кому нужнее внимание).
  const sorted = [...rows].sort(
    (a, b) => missedCount(b) - missedCount(a),
  );
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs" style={{ color: CHART.faint }}>
            <th className="py-2 pr-3 font-medium">Сотрудник</th>
            <th className="py-2 pr-3 text-right font-medium">Утро</th>
            <th className="py-2 pr-3 text-right font-medium">Вечер</th>
            <th className="py-2 text-right font-medium">Ритм</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.personId}
              className="border-b border-border-subtle/50"
            >
              <td className="py-2 pr-3 font-medium" style={{ color: CHART.text }}>
                {r.personName}
              </td>
              <td className="py-2 pr-3 text-right">
                <SlotCell
                  completed={r.morningCompleted}
                  expected={r.morningExpected}
                />
              </td>
              <td className="py-2 pr-3 text-right">
                <SlotCell
                  completed={r.eveningCompleted}
                  expected={r.eveningExpected}
                />
              </td>
              <td className="py-2 text-right">
                <RhythmChip row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ячейка слота «сдано / ожидалось». Нет ожидаемых → «—». */
function SlotCell({
  completed,
  expected,
}: {
  completed: number;
  expected: number;
}) {
  if (expected === 0) {
    return (
      <span className="text-xs" style={{ color: CHART.faint }}>
        —
      </span>
    );
  }
  const missed = expected - completed;
  return (
    <span className="tabular-nums text-xs" style={{ color: CHART.dim }}>
      {completed} из {expected}
      {missed > 0 ? (
        <span className="ml-1" style={{ color: CHART.amber }}>
          (−{missed})
        </span>
      ) : null}
    </span>
  );
}

/**
 * Чип «ритма». Всё сдано → «в ритме» (мята); есть пропуски → CTA «напомнить»
 * (янтарь); много пропусков → «чем помочь» (мягкий нейтральный тон).
 * Тон «вернуть в ритм», без штрафных процентов.
 */
function RhythmChip({ row }: { row: CheckinDisciplinePersonDomain }) {
  const expected = row.morningExpected + row.eveningExpected;
  const missed = missedCount(row);
  if (expected === 0) {
    return (
      <span className="text-xs" style={{ color: CHART.faint }}>
        —
      </span>
    );
  }
  if (missed === 0) {
    return (
      <span className="rounded-full bg-chip-success-bg px-2 py-0.5 text-[11px] font-medium text-chip-success-fg">
        в ритме
      </span>
    );
  }
  // Больше половины слотов пропущено — мягкий сигнал «чем помочь», иначе
  // лёгкое «напомнить».
  const heavy = missed > expected / 2;
  return heavy ? (
    <span className="rounded-full bg-chip-info-bg px-2 py-0.5 text-[11px] font-medium text-chip-info-fg">
      чем помочь
    </span>
  ) : (
    <span className="rounded-full bg-chip-warning-bg px-2 py-0.5 text-[11px] font-medium text-chip-warning-fg">
      напомнить
    </span>
  );
}

function missedCount(r: CheckinDisciplinePersonDomain): number {
  return r.morningMissed + r.eveningMissed;
}
