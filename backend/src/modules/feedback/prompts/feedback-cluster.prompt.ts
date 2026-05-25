/**
 * Системный промпт для AI-агента кластеризации обратной связи.
 *
 * Registry key: `feedback.cluster` (admin-editable, см. фазу 4 ТЗ).
 * Этот файл — **code-fallback**: если в БД нет активной версии промпта,
 * используется текст ниже.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md
 * раздел «Промпт агента».
 *
 * NB: содержание промпта и Zod-схема FeedbackClusterOutputSchema
 * будут заполнены в Фазе 4. Сейчас — только стаб-экспорт, чтобы
 * предотвратить ошибки импорта из сервиса.
 */

export const FEEDBACK_CLUSTER_PROMPT_KEY = 'feedback.cluster' as const;

/**
 * Code-fallback системного промпта. Реальный текст добавляется в Фазе 4
 * (вместе с Zod-схемой FeedbackClusterOutputSchema и тестом-фикстурой).
 */
export const FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK = `# TODO (фаза 4): см. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md`;
