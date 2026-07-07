import { describe, expect, it } from 'vitest';

import {
  aggregate,
  resolveHitRate,
  retrievalRecall,
  signatureHit,
  subQuestionLift,
  type PerQuestionMetrics,
  type Signature,
} from './stage-metrics';

const pool = [
  'Решение: использовать LiveKit для медиа-движка встреч',
  'Блокер: ошибка 429 при массовом синке Битрикс блокирует синхронизацию',
  'Цель квартала: поднять недельный retention с 42% до 55%',
];

describe('signatureHit · сигнатура резолвится к тексту пула', () => {
  it('по entity ИЛИ по фразе', () => {
    expect(signatureHit({ entity: 'LiveKit', phrases: ['медиа'] }, pool)).toBe(true);
    expect(signatureHit({ entity: '429', phrases: ['синхрониз'] }, pool)).toBe(true);
    expect(signatureHit({ phrases: ['42', '55'] }, pool)).toBe(true);
  });

  it('отсутствующая сигнатура → miss', () => {
    expect(signatureHit({ entity: 'Zoom', phrases: ['zoom'] }, pool)).toBe(false);
    expect(signatureHit({ phrases: [] }, pool)).toBe(false);
  });
});

describe('retrievalRecall', () => {
  it('все сигнатуры в пуле → 1', () => {
    const sigs: Signature[] = [
      { entity: 'LiveKit', phrases: ['медиа'] },
      { entity: '429', phrases: ['синхрониз'] },
    ];
    expect(retrievalRecall(sigs, pool)).toBe(1);
  });

  it('половина в пуле → 0.5', () => {
    const sigs: Signature[] = [
      { entity: 'LiveKit', phrases: ['медиа'] },
      { entity: 'Zoom', phrases: ['zoom'] },
    ];
    expect(retrievalRecall(sigs, pool)).toBe(0.5);
  });

  it('нет сигнатур (honest_empty) → 1', () => {
    expect(retrievalRecall([], pool)).toBe(1);
  });
});

describe('resolveHitRate', () => {
  it('полное совпадение имён (в т.ч. подстрока)', () => {
    expect(resolveHitRate(['Михаил', 'Битрикс'], ['Михаил Разработчик', 'Битрикс API'])).toBe(1);
  });

  it('частичное покрытие', () => {
    expect(resolveHitRate(['Михаил', 'Анна'], ['Михаил'])).toBe(0.5);
  });

  it('нет ожидаемых → 1; нет совпадений → 0', () => {
    expect(resolveHitRate([], ['кто угодно'])).toBe(1);
    expect(resolveHitRate(['Наталья'], ['Игорь'])).toBe(0);
  });
});

describe('subQuestionLift', () => {
  it('экспансия поднимает recall → положительный lift', () => {
    expect(subQuestionLift(0.8, 0.5)).toBe(0.3);
  });
  it('без прироста → 0', () => {
    expect(subQuestionLift(0.6, 0.6)).toBe(0);
  });
});

describe('aggregate · средние, null-строки пропускаются', () => {
  it('усредняет числовые, игнорирует null', () => {
    const rows: PerQuestionMetrics[] = [
      { id: 'a', retrievalRecall: 1, resolveHit: 1, faithfulness: 1, subQuestionLift: 0.2 },
      { id: 'b', retrievalRecall: 0.5, resolveHit: 0, faithfulness: null, subQuestionLift: null },
    ];
    const agg = aggregate(rows);
    expect(agg.n).toBe(2);
    expect(agg.retrievalRecall).toBe(0.75);
    expect(agg.resolveHit).toBe(0.5);
    expect(agg.faithfulness).toBe(1);
    expect(agg.subQuestionLift).toBe(0.2);
  });

  it('пустой вход → null-метрики', () => {
    const agg = aggregate([]);
    expect(agg.n).toBe(0);
    expect(agg.retrievalRecall).toBeNull();
  });
});
