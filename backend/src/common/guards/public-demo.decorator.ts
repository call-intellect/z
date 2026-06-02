import { SetMetadata } from '@nestjs/common';

/**
 * PUBLIC_DEMO_KEY — метаданные-маркер для DemoObserverGuard. Эндпоинт с
 * `@PublicDemo()` декоратором пропускается guard'ом даже для роли `demo_observer`.
 * Применяется для эндпоинтов, которые НЕ мутируют доменные данные:
 *   - LLM-вопросы концержа (read-only по природе);
 *   - read-через-POST поиск (если такие появятся).
 *
 * Источник: ТЗ plans/tz/2026-06-01-demo-shared-org-model.md §4.3.
 */
export const PUBLIC_DEMO_KEY = 'public_demo';

/** Точечное исключение из DemoObserverGuard. */
export const PublicDemo = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_DEMO_KEY, true);
