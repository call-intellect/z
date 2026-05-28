/**
 * Типы для onboarding-туров. ТЗ 2026-05-27.
 *
 * Шаг тура (TourStep) — позиционируется относительно `target` (CSS-селектор
 * data-tour-target атрибута). Если target не найден в DOM на момент рендера,
 * показываем подсказку по центру экрана (fallback) — но это сигнал, что тур
 * запустили не на той странице.
 */

export type TourId = 'welcome' | 'project' | 'meeting' | 'overview';

export type TourPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'center';

export interface TourStepAction {
  /** Подпись кнопки. */
  label: string;
  /** Действие при клике: next/prev/skip/complete/navigate. */
  kind: 'next' | 'prev' | 'skip' | 'complete' | 'navigate';
  /** URL для перехода — обязателен при kind='navigate'. */
  href?: string;
}

export interface TourStep {
  /** Стабильный id шага, используется в метриках (label `at_step`). */
  id: string;
  /** CSS-селектор target-элемента (обычно [data-tour-target="..."]). */
  target: string;
  /** Заголовок подсказки. */
  title: string;
  /** Текст подсказки (русский, без английских слов). */
  body: string;
  /** Куда позиционируем поповер. На mobile игнорируется (bottom-sheet). */
  placement: TourPlacement;
  /** Главная кнопка (вправо). */
  primaryAction: TourStepAction;
  /** Опциональная второстепенная кнопка (например, «Пропустить» вместо «Дальше»). */
  secondaryAction?: TourStepAction;
}

export interface TourDefinition {
  id: TourId;
  steps: TourStep[];
}
