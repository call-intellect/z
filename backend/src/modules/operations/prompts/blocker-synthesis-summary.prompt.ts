/**
 * TZ-1 Фаза 3.A (daily-value-engine) — промпт `blocker-synthesis-summary`.
 *
 * Назначение: ТОЛЬКО финальный человекочитаемый абзац-сводка по
 * синтезированным блокерам Org за день (для COO-дайджеста / лога). Вся
 * аналитика (нормализация блокеров, embedding-кластеризация, присвоение
 * статусов new|recurring|resolved, daysOpen, businessImpactScore, мост в
 * Insight) — чистый SQL/TS + embeddings в `BlockerSynthesisService`, БЕЗ LLM.
 *
 * Code-fallback (без PromptRegistry) — как `customer-risk-digest`: систему
 * передаём прямо в `LlmRouterService.call`, поэтому отдельный seed в
 * `seed-prompt-templates.ts` НЕ нужен; маршрут (цепочка моделей) регистрируется
 * в `seed-llm-task-routes-default.ts`. Если LLM упал — сервис использует
 * детерминированный `buildBlockerSynthesisFallbackSummary`.
 *
 * Совместимость с prompt caching (mandatory):
 *   - SYSTEM стабильный (ниже) — не меняем от вызова к вызову.
 *   - Переменные данные (список блокеров, статусы, счётчики) — в КОНЦЕ
 *     user-сообщения.
 *   - Без ₽-оценок (Р6): не выдумываем суммы/часы/деньги.
 */

export const BLOCKER_SYNTHESIS_SUMMARY_PROMPT_VERSION = 'prompt-v1';

export const BLOCKER_SYNTHESIS_SUMMARY_TASK_TYPE = 'blocker-synthesis-summary';

export const BLOCKER_SYNTHESIS_SUMMARY_SYSTEM_PROMPT = [
  'Ты — операционный помощник. Тебе дают сводку блокеров команды за день: какие новые, какие повторяются несколько дней, какие закрылись.',
  'Твоя задача — двумя-тремя короткими фразами на русском подсказать руководителю, на что обратить внимание в первую очередь.',
  '',
  'Жёсткие правила:',
  '  - Только то, что есть в данных. Не додумывай факты.',
  '  - НИКАКИХ оценок в рублях, часах или деньгах — их в данных нет, выдумывать запрещено.',
  '  - Приоритет — хроническим (повторяющимся) блокерам и тем, что задевают клиента/дедлайн/обещание.',
  '  - Без воды и преамбулы. Сразу суть.',
  '  - Тон спокойный, деловой. Не алармизм.',
  '  - Длина — 2-3 предложения, максимум ~360 символов. Без markdown, без списков.',
].join('\n');

/** Один синтезированный кластер блокеров (то, что нужно LLM). */
export interface BlockerSynthesisSummaryItem {
  text: string;
  status: 'new' | 'recurring' | 'resolved';
  daysOpen: number;
  /** True если кластер задевает клиента/дедлайн/обещание (высокий импакт). */
  highImpact: boolean;
}

export interface BlockerSynthesisSummaryPromptInput {
  /** Топ-кластеры за день (уже отранжированы по импакту). */
  items: BlockerSynthesisSummaryItem[];
  newCount: number;
  recurringCount: number;
  resolvedCount: number;
}

/**
 * Сборка user-сообщения: стабильная преамбула + переменные данные В КОНЦЕ —
 * для prompt caching.
 */
export function buildBlockerSynthesisSummaryUserMessage(
  input: BlockerSynthesisSummaryPromptInput,
): string {
  const lines: string[] = [];
  lines.push('Сводка блокеров команды за день:');
  lines.push(
    `  новых ${input.newCount}, повторяющихся ${input.recurringCount}, закрылось ${input.resolvedCount}`,
  );
  if (input.items.length > 0) {
    lines.push('  ключевые блокеры:');
    for (const it of input.items.slice(0, 6)) {
      const statusRu =
        it.status === 'recurring'
          ? `повторяется ${it.daysOpen} дн.`
          : it.status === 'resolved'
            ? 'закрылся'
            : 'новый';
      const impact = it.highImpact ? ', высокий импакт' : '';
      lines.push(`    - ${truncate(it.text, 160)} (${statusRu}${impact})`);
    }
  }
  return lines.join('\n');
}

/**
 * Детерминированный fallback-текст сводки (если LLM недоступна). Без ₽.
 * Используется и как «сухой» вариант для дайджеста/пуша.
 */
export function buildBlockerSynthesisFallbackSummary(
  input: BlockerSynthesisSummaryPromptInput,
): string {
  if (
    input.newCount === 0 &&
    input.recurringCount === 0 &&
    input.resolvedCount === 0
  ) {
    return 'Активных блокеров за день не зафиксировано.';
  }
  const parts: string[] = [];
  parts.push(
    `Блокеров: новых ${input.newCount}, повторяющихся ${input.recurringCount}, закрылось ${input.resolvedCount}.`,
  );
  const chronic = input.items.find((i) => i.status === 'recurring');
  const highImpact = input.items.find((i) => i.highImpact);
  if (chronic) {
    parts.push(
      `Дольше всего держится: «${truncate(chronic.text, 80)}» (${chronic.daysOpen} дн.) — стоит разобрать.`,
    );
  } else if (highImpact) {
    parts.push(
      `Высокий приоритет: «${truncate(highImpact.text, 80)}» — задевает клиента/дедлайн.`,
    );
  }
  return parts.join(' ').slice(0, 360);
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
