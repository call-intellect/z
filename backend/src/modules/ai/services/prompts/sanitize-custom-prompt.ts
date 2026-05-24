/**
 * Sanitize пользовательского `customPrompt` (Meeting.customPrompt). См.
 * plans/tz/2026-05-24-prompts-hardening.md §4.2 «defense-in-depth, 2 слоя».
 *
 * Что делаем:
 *   1. Жёсткий truncate до {@link CUSTOM_PROMPT_MAX_LENGTH} (anti-stuffing).
 *   2. Сканируем regex'ами по типовым injection-паттернам.
 *
 * Чего НЕ делаем:
 *   - Не отклоняем промт даже при срабатывании паттерна. Структурный слой
 *     (см. `wrapUserData` / `INJECTION_GUARD_NOTE` в `common.ts`) обернёт
 *     customPrompt в маркеры данных, и LLM по системному правилу
 *     проигнорирует попытки переопределить роль. Отклонение легитимных
 *     пользовательских промтов из-за «похожих слов» хуже, чем потерянная
 *     observability — мы бы поломали реальные кастомные шаблоны.
 *   - Не вычищаем содержимое из строки. Оставляем как есть — LLM получит
 *     полный текст, но в маркерах. `reasons` уезжает в метрику
 *     `z_prompt_injection_attempt_total` для алертинга / UI-бэйджей.
 *
 * Идентификаторы паттернов (для labels метрики) держим стабильными —
 * по ним строится Grafana-алёрт.
 */

/**
 * Максимальная длина customPrompt после sanitize. Защита от «context stuffing»
 * — длинного полотна, в которое спрятана инъекция в самом конце.
 */
export const CUSTOM_PROMPT_MAX_LENGTH = 4000;

/**
 * Паттерны с короткими идентификаторами для метрики. id — стабильный
 * человекочитаемый ключ; в Prometheus уйдёт `pattern="ignore_prev"`.
 */
export const FORBIDDEN_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly regex: RegExp;
}> = [
  // «Ignore previous/all/prior/above instructions»
  { id: 'ignore_prev', regex: /ignore\s+(?:all\s+)?(?:previous|prior|above)/i },
  // «Игнорируй / Игнорируйте предыдущие / все / прошлые …»
  {
    id: 'ignore_prev_ru',
    regex: /игнорируй(?:те)?\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние|инструкции|правила)/i,
  },
  // «Забудь предыдущие/все/прошлые …»
  { id: 'forget_prev_ru', regex: /забудь\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние)/i },
  // Попытка симулировать system-сообщение `system:` / `System:`
  { id: 'system_prefix', regex: /(?:^|\n)\s*system\s*:/i },
  // ChatML / OpenAI tokens (`<|im_start|>`, `<|im_end|>`)
  { id: 'chatml_tokens', regex: /<\|im_start\|>|<\|im_end\|>/ },
  // Двойные скобки `[[system]]` / `[[ system ]]`
  { id: 'bracket_system', regex: /\[\[\s*system\s*\]\]/i },
];

/**
 * Результат sanitize. `rejected` всегда `false` (см. jsdoc сверху —
 * мы не отклоняем); поле оставлено в типе для будущей фазы (если решим
 * жестить customPrompt в admin-моде).
 */
export interface SanitizeResult {
  /** Текст после truncate. Для UX подавай в LLM ВНУТРИ маркеров `wrapUserData`. */
  readonly cleaned: string;
  /** Всегда false на текущей фазе. Зарезервировано. */
  readonly rejected: false;
  /** Список сработавших pattern.id. Пустой массив = чисто. */
  readonly reasons: string[];
}

/**
 * Основная функция sanitize. См. jsdoc файла. Чистый помощник без побочных
 * эффектов — метрику инкрементирует caller (см. `analyze.worker.runCustomPrompt`).
 */
export function sanitizeCustomPrompt(raw: string): SanitizeResult {
  const cleaned = (raw ?? '').slice(0, CUSTOM_PROMPT_MAX_LENGTH);
  const reasons: string[] = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(cleaned)) {
      reasons.push(pattern.id);
    }
  }
  return { cleaned, rejected: false, reasons };
}
