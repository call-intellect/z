import { describe, expect, it } from 'vitest';

import { deterministicClean, type CleanerInputSegment } from './deterministic-cleaner';

describe('deterministicClean', () => {
  const mkSeg = (text: string, idx = 0): CleanerInputSegment => ({
    participantIdentity: 'host:1',
    startMs: idx * 1000,
    endMs: idx * 1000 + 800,
    text,
  });

  it('удаляет filler-слова из словаря (эээ, типа, как бы)', () => {
    const input = [mkSeg('Эээ, я думаю, типа, нам надо как бы переделать сайт.')];
    const out = deterministicClean(input);
    expect(out.segments).toHaveLength(1);
    const seg = out.segments[0]!;
    expect(seg.cleanedText.toLowerCase()).not.toContain('эээ');
    expect(seg.cleanedText.toLowerCase()).not.toContain('типа');
    expect(seg.cleanedText.toLowerCase()).not.toContain('как бы');
    expect(seg.cleanedText.toLowerCase()).toContain('я думаю');
    expect(seg.cleanedText.toLowerCase()).toContain('переделать сайт');
    expect(out.stats.fillerWordsRemoved).toBeGreaterThanOrEqual(3);
    expect(out.stats.charsAfter).toBeLessThan(out.stats.charsBefore);
    const fillerHits = seg.removed.filter((r) => r.type === 'filler');
    expect(fillerHits.length).toBeGreaterThanOrEqual(3);
  });

  it('НЕ трогает «ну» — это решает уровень 2 (LLM-refine)', () => {
    const input = [mkSeg('Ну? И что дальше? Ну хорошо, давайте обсудим.')];
    const out = deterministicClean(input);
    const seg = out.segments[0]!;
    expect(seg.cleanedText.toLowerCase()).toMatch(/ну/);
    expect(seg.cleanedText.toLowerCase()).toContain('давайте обсудим');
  });

  it('сжимает повторы 2 и 3 одинаковых слов подряд', () => {
    const input = [
      mkSeg('Я я я думаю что давайте давайте обсудим.', 0),
      mkSeg('Так так так так, мы должны решить вопрос.', 1),
    ];
    const out = deterministicClean(input);
    expect(out.segments).toHaveLength(2);
    const seg0 = out.segments[0]!;
    expect(seg0.cleanedText).toMatch(/^Я думаю/);
    expect((seg0.cleanedText.toLowerCase().match(/давайте/g) ?? []).length).toBe(1);

    const seg1 = out.segments[1]!;
    expect(seg1.cleanedText.toLowerCase()).not.toMatch(/так\s+так/);
    expect(seg1.cleanedText.toLowerCase()).toContain('мы должны решить вопрос');

    expect(out.stats.repeatsRemoved).toBeGreaterThanOrEqual(3);
  });

  it('удаляет segment, состоящий целиком из одиночных междометий', () => {
    const input = [
      mkSeg('Ага.', 0),
      mkSeg('Хорошая идея, давайте делать.', 1),
      mkSeg('Угу.', 2),
      mkSeg('Мхм', 3),
    ];
    const out = deterministicClean(input);
    expect(out.segments).toHaveLength(4);
    expect(out.segments[0]!.cleanedText).toBe('');
    expect(out.segments[0]!.removed[0]?.type).toBe('filler');
    expect(out.segments[1]!.cleanedText).toContain('Хорошая идея');
    expect(out.segments[2]!.cleanedText).toBe('');
    expect(out.segments[3]!.cleanedText).toBe('');
    expect(out.segments.map((s) => s.originalIndex)).toEqual([0, 1, 2, 3]);
    expect(out.segments[2]!.startMs).toBe(2000);
  });

  it('НЕ ломает содержательную речь (regression на §12 рисков)', () => {
    const text =
      'Мы договорились, что Иван подготовит документы к пятнице, а Мария проверит их в субботу.';
    const out = deterministicClean([mkSeg(text)]);
    const seg = out.segments[0]!;
    expect(seg.cleanedText).toBe(text);
    expect(seg.removed).toHaveLength(0);
    expect(out.stats.fillerWordsRemoved).toBe(0);
    expect(out.stats.repeatsRemoved).toBe(0);
    expect(out.stats.charsAfter).toBe(out.stats.charsBefore);
  });

  it('сохраняет originalIndex как монотонно возрастающий — для mapping тайм-кодов', () => {
    const segs = Array.from({ length: 7 }, (_, i) => mkSeg(`Реплика ${i + 1}.`, i));
    const out = deterministicClean(segs);
    expect(out.segments.map((s) => s.originalIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(out.segments[3]!.startMs).toBe(3000);
    expect(out.segments[3]!.endMs).toBe(3800);
  });
});
