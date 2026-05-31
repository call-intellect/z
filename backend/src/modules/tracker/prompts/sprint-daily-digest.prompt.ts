/**
 * Pulse Wave 5 §5.1 (2026-05-30, plans/tz/2026-05-30-pulse-full.md §5.1) —
 * SprintAnalyst.getDailyDigest — связный нарратив AI Daily Standup для
 * дашборда спринта (таб «Daily»).
 *
 * Cache-friendly (см. feedback_llm_prompts_cache_friendly.md):
 *   - SYSTEM полностью статичен → 99% prompt cache hit на DeepSeek / OpenAI-proxy;
 *   - переменные данные (метрики дня) — в КОНЦЕ user-сообщения JSON-блоком.
 *
 * EU AI Act §1.3: на вход — только структурированные метрики и заголовки
 * задач; никаких эмоций, голосового анализа, surveillance-стиля. Выход —
 * markdown 4-6 коротких абзацев на русском.
 */

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
  /** Название спринта. */
  cycleName: string;
  /** Гипотеза спринта (первый абзац description) либо null. */
  hypothesisText: string | null;
  /** День N из M. */
  elapsedDays: number;
  durationDays: number;
  /** Прогресс. */
  total: number;
  completed: number;
  inProgress: number;
  /** Кол-во активных подсказок помощника. */
  activeHintsCount: number;
  /** Кол-во критических подсказок (severity=critical либо kind=due_date_at_risk). */
  alarmCount: number;
  /** Топ-5 задач at-risk (краткие заголовки). */
  topRisks: string[];
  /** Топ-5 задач без движения (краткие заголовки). */
  topStale: string[];
  /** Кол-во переносов с прошлых циклов. */
  carryOverCount: number;
}

/**
 * Cache-friendly правило: имя спринта — сверху, переменные данные внизу
 * JSON-блоком.
 */
export function buildSprintDailyDigestUserMessage(
  input: SprintDailyDigestInput,
): string {
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
          completedPercent:
            input.total > 0
              ? Math.round((input.completed / input.total) * 100)
              : 0,
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
