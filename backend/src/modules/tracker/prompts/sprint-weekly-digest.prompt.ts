/**
 * Pulse Wave 5 §5.2 (2026-05-30, plans/tz/2026-05-30-pulse-full.md §5.2) —
 * SprintAnalyst.getWeeklyDigest — AI Weekly Sprint Summary для дашборда
 * спринта (таб «Weekly»).
 *
 * Cache-friendly: SYSTEM статичен, переменные данные в конце user-сообщения.
 * EU AI Act: только структурированные метрики и заголовки задач — никаких
 * эмоций, surveillance-стиля или ранжирования сотрудников.
 *
 * Выход — markdown 5-7 коротких абзацев на русском.
 */

export const SPRINT_WEEKLY_DIGEST_SYSTEM_PROMPT = `Ты — стратегический помощник по итогам недели спринта.
Анализируешь, что произошло за неделю и куда движется команда.

Стиль: деловой, человечный, без воды. Не оценивай людей — описывай факты, тренды, выводы.

Структура ответа (markdown, 5-7 коротких абзацев):
1. Recap гипотезы спринта (1 предложение) и подтверждается ли она.
2. Что закрыто за неделю и какой прогресс относительно плана.
3. Velocity / throughput по сравнению с прошлым спринтом.
4. Что мы узнали за неделю (инсайты, knowledge gap).
5. Прогноз закрытия и что взять в действия retro.

Объём ≤ 1200 символов. Без markdown-заголовков (только параграфы). Без emoji.`;

export interface SprintWeeklyDigestInput {
  cycleName: string;
  hypothesisText: string | null;
  /** День N из M (фактический elapsed). */
  elapsedDays: number;
  durationDays: number;
  /** Прогресс. */
  total: number;
  completed: number;
  inProgress: number;
  /** Velocity недели — задачи, закрытые за последние 7 дней. */
  closedThisWeek: number;
  /** Velocity прошлой недели спринта — задачи, закрытые в предыдущие 7 дней. */
  closedPrevWeek: number;
  /** Кол-во активных подсказок и критичных. */
  activeHintsCount: number;
  alarmCount: number;
  /** Краткие заголовки инсайтов («что узнали») — top-5. */
  insights: string[];
  /** Прогноз закрытия от Forecaster (если есть). */
  forecastTrend: 'improving' | 'stable' | 'declining' | null;
  /** Краткое summary expectedShifts от Forecaster. */
  forecastSummary: string | null;
}

export function buildSprintWeeklyDigestUserMessage(
  input: SprintWeeklyDigestInput,
): string {
  return [
    `Спринт: ${input.cycleName}.`,
    ``,
    `Сделай связный недельный summary на основе данных ниже.`,
    ``,
    JSON.stringify(
      {
        hypothesis: input.hypothesisText,
        progress: {
          elapsedDays: input.elapsedDays,
          durationDays: input.durationDays,
          total: input.total,
          completed: input.completed,
          inProgress: input.inProgress,
          completedPercent:
            input.total > 0
              ? Math.round((input.completed / input.total) * 100)
              : 0,
        },
        velocity: {
          closedThisWeek: input.closedThisWeek,
          closedPrevWeek: input.closedPrevWeek,
        },
        risks: {
          activeHintsCount: input.activeHintsCount,
          alarmCount: input.alarmCount,
        },
        learnings: input.insights,
        forecast: {
          trend: input.forecastTrend,
          summary: input.forecastSummary,
        },
      },
      null,
      2,
    ),
  ].join('\n');
}
