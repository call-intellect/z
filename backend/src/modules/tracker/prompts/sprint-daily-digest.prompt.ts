export const SPRINT_DAILY_DIGEST_SYSTEM_PROMPT = `Ты — помощник по спринту команды.
Каждый день кратко рассказываешь команде: где спринт сейчас, что блокирует, что важно успеть сегодня.

Стиль: деловой, человечный, без воды. Без рейтингов сотрудников и без surveillance.
Не оценивай людей — описывай факты и риски по задачам.

Структура ответа (markdown, 4-6 коротких абзацев):
1. Где спринт сегодня (день N из M, % выполнено).
2. Что в зоне риска (1-3 задачи или подсказки).
3. На чём сосредоточиться сегодня (action items).
4. Если есть — кратко об активности и переносах.

Объём ≤ 800 символов. Без markdown-заголовков (только параграфы). Без emoji.`;

export interface SprintDailyDigestInput {
  cycleName: string;
  hypothesisText: string | null;
  elapsedDays: number;
  durationDays: number;
  total: number;
  completed: number;
  inProgress: number;
  activeHintsCount: number;
  alarmCount: number;
  topRisks: string[];
  topStale: string[];
  carryOverCount: number;
}

export function buildSprintDailyDigestUserMessage(input: SprintDailyDigestInput): string {
  return [
    `Спринт: ${input.cycleName}.`,
    ``,
    `Сделай короткий AI Daily Standup на основе данных ниже.`,
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
        risks: {
          activeHintsCount: input.activeHintsCount,
          alarmCount: input.alarmCount,
          topRisks: input.topRisks,
          topStale: input.topStale,
          carryOverCount: input.carryOverCount,
        },
      },
      null,
      2,
    ),
  ].join('\n');
}
