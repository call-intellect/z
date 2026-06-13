import { describe, expect, it } from 'vitest';

import type { ValueRecapSlideDto } from '../dto/value-recap.dto';

import { buildValueRecapPptx } from './value-recap-pptx';

/**
 * Ф3 редизайн (Итоги месяца) — unit-тест PPTX-генератора. Проверяем, что
 * возвращается непустой Buffer с сигнатурой OOXML/ZIP («PK»). Детерминизм —
 * без БД/сети (pptxgenjs pure-JS).
 */
describe('buildValueRecapPptx', () => {
  const slides: ValueRecapSlideDto[] = [
    {
      title: 'Итоги месяца 2026-05',
      subtitle: 'Снятая рутина',
      bullets: ['Встреч запротоколировано: 12', 'Задач извлечено: 40'],
    },
    {
      title: 'Решения месяца',
      subtitle: 'Всего 8, доведено 50%',
      bullets: ['Перейти на ежедневные планёрки — внедрено (100%)'],
    },
  ];

  it('возвращает непустой Buffer с сигнатурой ZIP «PK»', async () => {
    const buf = await buildValueRecapPptx(slides);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // OOXML (.pptx) — это ZIP-контейнер: первые два байта 0x50 0x4B = «PK».
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('пустой список слайдов → валидный непустой PPTX (заглушка)', async () => {
    const buf = await buildValueRecapPptx([]);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
