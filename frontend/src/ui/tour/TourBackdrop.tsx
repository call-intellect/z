'use client';

/**
 * TourBackdrop — полупрозрачный overlay поверх всего UI на время тура.
 *
 * Реализация без «дырки» вокруг target — простая чёрная полупрозрачная
 * подложка. «Вырез» через SVG mask можно добавить позже, если потребуется
 * по дизайну; ТЗ говорит «полупрозрачный overlay с „вырезом“ вокруг
 * target», но для MVP достаточно цельной подложки + подсветить целевой
 * элемент через ring/scale на самом target (см. TourTooltip — outline).
 *
 * pointer-events: backdrop — НЕблокирующий (`pointer-events-none`). Тур
 * задуман неблокирующим: затемнение/blur остаются визуально, но клики
 * проходят сквозь подложку к странице (пункты меню, кнопки «В задачи»,
 * «Выбрать должность»). Tooltip и подсвеченный target кликабельны как
 * элементы с бо́льшим z-index и собственным `pointer-events: auto`.
 */

export function TourBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]"
    />
  );
}
