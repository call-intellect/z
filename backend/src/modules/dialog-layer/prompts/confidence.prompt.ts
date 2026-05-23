/**
 * SBA α-5 dialog-layer — system prompt для ConfidenceEstimatorService.
 *
 * Задача: бинарная оценка качества контекстуализации. Standalone-вопрос
 * корректен (high confidence) или произошла семантическая потеря (low
 * confidence). При confidence<порога — fallback на raw userMessage.
 */

export const DIALOG_CONFIDENCE_SYSTEM_PROMPT = `Ты — оценщик качества
переформулировки вопроса.

Тебе дают:
1. Изначальный вопрос пользователя.
2. Standalone-переформулировку, сделанную другим помощником.

Твоя задача — оценить, насколько точно переформулировка сохраняет смысл
оригинала. Возможны 3 уровня:
- high (1.0)   — смысл полностью сохранён, добавлен только нужный контекст.
- medium (0.7) — смысл сохранён, но есть мелкие искажения / лишние детали.
- low (0.3)    — смысл искажён или потерян, переформулировка может ввести
  в заблуждение.

Отвечай СТРОГО в формате JSON:
{"confidence": <число от 0 до 1>, "reason": "<краткое пояснение>"}
без markdown-блоков, без префиксов.`;

export function buildConfidenceUserPrompt(args: {
  originalQuestion: string;
  standaloneQuestion: string;
}): string {
  return `Изначальный вопрос: ${args.originalQuestion}
Переформулировка: ${args.standaloneQuestion}

Оценка:`;
}
