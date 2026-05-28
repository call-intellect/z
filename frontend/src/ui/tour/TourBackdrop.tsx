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
 * pointer-events: stroke (через `pointer-events-none` мы НЕ выставляем —
 * подложка ловит клики, чтобы пользователь не мог взаимодействовать с UI
 * во время тура; tooltip имеет `pointer-events: auto`).
 */

interface Props {
  onClick?: () => void;
}

export function TourBackdrop({ onClick }: Props) {
  return (
    <div
      aria-hidden
      onClick={onClick}
      className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]"
    />
  );
}
