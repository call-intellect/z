/**
 * Ф3 редизайн (Итоги месяца) — генерация PPTX-презентации поверх готового
 * структурного slides-JSON (`buildValueRecapSlides`). Один `ValueRecapSlideDto`
 * → один слайд (крупный заголовок + подзаголовок + буллеты).
 *
 * pptxgenjs — pure-JS (JSZip под капотом), без native-биндингов; в Node
 * `write({ outputType: 'nodebuffer' })` отдаёт Buffer (OOXML/ZIP, сигнатура
 * `PK`). Тема нейтрально-тёмная, RU-текст как есть.
 *
 * Честность (Р6): рендерим ровно те слайды, что собрал `buildValueRecapSlides`
 * (только твёрдые данные + soft со словом «оценка»). Здесь — только верстка.
 */

import PptxGenJS from 'pptxgenjs';

import type { ValueRecapSlideDto } from '../dto/value-recap.dto';

/** Палитра (hex без #, как требует pptxgenjs). */
const COLOR_BG = '14161F'; // тёмный фон
const COLOR_TITLE = 'FFFFFF';
const COLOR_SUBTITLE = 'A9B0C0';
const COLOR_BULLET = 'E6E9F0';
const COLOR_ACCENT = '7C5CFF'; // фиолет-герой (как в редизайне)

/**
 * Построить PPTX из набора слайдов. Возвращает Buffer (OOXML/ZIP «PK…»).
 * Пустой `slides` → презентация с одним титульным слайдом-заглушкой (валидный
 * непустой PPTX, не падаем).
 */
export async function buildValueRecapPptx(
  slides: ValueRecapSlideDto[],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = 'Кора';
  pptx.company = 'Кора';
  pptx.title = 'Итоги месяца';
  // 16:9, 13.33" × 7.5".
  pptx.layout = 'LAYOUT_WIDE';

  const list =
    slides.length > 0
      ? slides
      : [
          {
            title: 'Итоги месяца',
            subtitle: 'Данных пока недостаточно',
            bullets: [],
          } satisfies ValueRecapSlideDto,
        ];

  for (const s of list) {
    const slide = pptx.addSlide();
    slide.background = { color: COLOR_BG };

    // Акцентная полоса слева.
    slide.addShape('rect', {
      x: 0,
      y: 0,
      w: 0.18,
      h: 7.5,
      fill: { color: COLOR_ACCENT },
      line: { type: 'none' },
    });

    // Заголовок (крупно).
    slide.addText(s.title, {
      x: 0.6,
      y: 0.5,
      w: 12.1,
      h: 1.1,
      fontFace: 'Arial',
      fontSize: 36,
      bold: true,
      color: COLOR_TITLE,
      align: 'left',
      valign: 'top',
    });

    // Подзаголовок (опц.).
    let bodyY = 1.6;
    if (s.subtitle && s.subtitle.trim().length > 0) {
      slide.addText(s.subtitle, {
        x: 0.6,
        y: 1.55,
        w: 12.1,
        h: 0.6,
        fontFace: 'Arial',
        fontSize: 18,
        italic: true,
        color: COLOR_SUBTITLE,
        align: 'left',
        valign: 'top',
      });
      bodyY = 2.4;
    }

    // Буллеты.
    const bullets = (s.bullets ?? []).filter(
      (b) => typeof b === 'string' && b.trim().length > 0,
    );
    if (bullets.length > 0) {
      slide.addText(
        bullets.map((text) => ({
          text,
          options: { bullet: { code: '2022' }, breakLine: true },
        })),
        {
          x: 0.6,
          y: bodyY,
          w: 12.1,
          h: 7.5 - bodyY - 0.4,
          fontFace: 'Arial',
          fontSize: 18,
          color: COLOR_BULLET,
          align: 'left',
          valign: 'top',
          lineSpacingMultiple: 1.3,
        },
      );
    }
  }

  // outputType 'nodebuffer' → Node Buffer (OOXML/ZIP, «PK»). compression — −30%.
  const out = await pptx.write({ outputType: 'nodebuffer', compression: true });
  return out as Buffer;
}
