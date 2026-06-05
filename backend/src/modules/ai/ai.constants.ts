/**
 * AI-модуль — стабильные числовые константы.
 */

/**
 * Имя advisory-lock-неймспейса для two-tier ретеншена `AiUsageLog`
 * (см. `services/ai-usage-log-cleanup.service.ts`).
 *
 * Свой отдельный ключ — НЕ переиспользует `LOG_CLEANUP_LOCK_KEY`
 * (9_021_476_315) из LoggingModule, чтобы cleanup'ы не блокировали друг друга
 * на флоте.
 */
export const AI_USAGE_LOG_CLEANUP_LOCK_KEY = 9_021_476_316; // произвольная стабильная int-константа
