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
  elapsedDays: number;
  durationDays: number;
  total: number;
  completed: number;
  inProgress: number;
  closedThisWeek: number;
  closedPrevWeek: number;
  activeHintsCount: number;
  alarmCount: number;
  insights: string[];
  forecastTrend: 'improving' | 'stable' | 'declining' | null;
  forecastSummary: string | null;
}

export function buildSprintWeeklyDigestUserMessage(input: SprintWeeklyDigestInput): string {
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
          completedPercent: input.total > 0 ? Math.round((input.completed / input.total) * 100) : 0,
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
