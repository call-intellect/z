/**
 * TZ-1 Фаза 1 (daily-value-engine) — промпт `customer-risk-digest`.
 *
 * Назначение: ТОЛЬКО финальная человекочитаемая формулировка подсказки
 * менеджеру/руководителю про клиента под риском. Вся агрегация (группировка
 * блоков по клиенту, счётчики сигналов, взвешивание риска, дельта) — чистый
 * SQL/TS в `CustomerRiskRadarService`, БЕЗ LLM.
 *
 * Code-fallback (без PromptRegistry) — как `operations-daily-digest`: систему
 * передаём прямо в `LlmRouterService.call`, поэтому отдельный seed в
 * `seed-prompt-templates.ts` НЕ нужен; маршрут (цепочка моделей) регистрируется
 * в `seed-llm-task-routes-default.ts`. Если LLM упал — сервис использует
 * детерминированный `buildCustomerRiskFallbackHint`.
 *
 * Совместимость с prompt caching (mandatory):
 *   - SYSTEM стабильный (ниже) — не меняем от вызова к вызову.
 *   - Переменные данные (имя клиента, signalCounts, тексты блоков) — в КОНЦЕ
 *     user-сообщения.
 *   - Без ₽-оценок (Р6): не выдумываем суммы/часы/деньги.
 */

export const CUSTOMER_RISK_DIGEST_PROMPT_VERSION = 'prompt-v1';

export const CUSTOMER_RISK_DIGEST_TASK_TYPE = 'customer-risk-digest';

export const CUSTOMER_RISK_DIGEST_SYSTEM_PROMPT = [
  'Ты — операционный помощник. Тебе дают сводку сигналов по одному клиенту за окно наблюдения.',
  'Твоя задача — одной-двумя короткими фразами на русском подсказать менеджеру, в чём риск и что стоит сделать.',
  '',
  'Жёсткие правила:',
  '  - Только то, что есть в данных. Не додумывай факты.',
  '  - НИКАКИХ оценок в рублях, часах или деньгах — их в данных нет, выдумывать запрещено.',
  '  - Без воды и преамбулы. Сразу суть: какой сигнал преобладает и что проверить/сделать.',
  '  - Тон спокойный, деловой. Не алармизм.',
  '  - Длина — 1-2 предложения, максимум ~240 символов. Без markdown, без списков.',
].join('\n');

/** Вход для промпта (только то, что нужно LLM для формулировки). */
export interface CustomerRiskDigestPromptInput {
  customerName: string;
  riskLevel: 'critical' | 'warning' | 'ok';
  signalCounts: {
    churn_risk: number;
    objection: number;
    pain: number;
    feature_request: number;
  };
  /** Дельта риска к вчерашнему снимку (+приток / -отток сигналов). */
  signalDelta: number;
  /** До 3 коротких выдержек из блоков-источников (для контекста). */
  topBlockExcerpts: string[];
}

/**
 * Сборка user-сообщения: стабильная преамбула (если нужна) + переменные данные
 * В КОНЦЕ — для prompt caching.
 */
export function buildCustomerRiskDigestUserMessage(
  input: CustomerRiskDigestPromptInput,
): string {
  const lines: string[] = [];
  lines.push('Сводка по клиенту (за окно наблюдения):');
  lines.push(`  клиент: ${truncate(input.customerName, 120)}`);
  lines.push(`  уровень риска: ${riskLevelRu(input.riskLevel)}`);
  lines.push(
    `  сигналы: отток ${input.signalCounts.churn_risk}, ` +
      `возражения ${input.signalCounts.objection}, ` +
      `боли ${input.signalCounts.pain}, ` +
      `запросы доработок ${input.signalCounts.feature_request}`,
  );
  const deltaWord =
    input.signalDelta > 0
      ? `приток сигналов +${input.signalDelta}`
      : input.signalDelta < 0
        ? `отток сигналов ${input.signalDelta}`
        : 'динамика без изменений';
  lines.push(`  динамика к вчера: ${deltaWord}`);
  if (input.topBlockExcerpts.length > 0) {
    lines.push('  что говорили:');
    for (const ex of input.topBlockExcerpts.slice(0, 3)) {
      lines.push(`    - ${truncate(ex, 160)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Детерминированный fallback-текст подсказки (если LLM недоступна). Без ₽.
 * Используется и как «сухой» вариант для дайджеста/пуша.
 */
export function buildCustomerRiskFallbackHint(
  input: CustomerRiskDigestPromptInput,
): string {
  const c = input.signalCounts;
  // Выбираем преобладающий сигнал для формулировки.
  const dominant = pickDominant(c);
  const base = `Клиент «${truncate(input.customerName, 80)}» — риск ${riskLevelRu(
    input.riskLevel,
  )}.`;
  const reason =
    dominant === 'churn_risk'
      ? 'Преобладают сигналы оттока — стоит выйти на контакт.'
      : dominant === 'objection'
        ? 'Много возражений — проверьте, что закрыты ключевые вопросы.'
        : dominant === 'pain'
          ? 'Накопились боли клиента — разберите и снимите блокеры.'
          : 'Идут запросы доработок — уточните приоритеты по клиенту.';
  return `${base} ${reason}`.slice(0, 240);
}

function pickDominant(c: {
  churn_risk: number;
  objection: number;
  pain: number;
  feature_request: number;
}): 'churn_risk' | 'objection' | 'pain' | 'feature_request' {
  const order: Array<['churn_risk' | 'objection' | 'pain' | 'feature_request', number]> = [
    ['churn_risk', c.churn_risk],
    ['objection', c.objection],
    ['pain', c.pain],
    ['feature_request', c.feature_request],
  ];
  order.sort((a, b) => b[1] - a[1]);
  return order[0]![0];
}

function riskLevelRu(level: 'critical' | 'warning' | 'ok'): string {
  switch (level) {
    case 'critical':
      return 'критический';
    case 'warning':
      return 'повышенный';
    default:
      return 'в норме';
  }
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
