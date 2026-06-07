import { describe, expect, it } from 'vitest';

import {
  type GoldenTask,
  type VariantScore,
  formatDelta,
  normTitle,
  scoreDecisions,
  scoreExtraction,
} from './agent-scoring';

describe('agent-scoring · normTitle', () => {
  it('числа без разделителей тысяч схлопываются: «2 000» === «2000»', () => {
    expect(normTitle('2 000')).toBe(normTitle('2000'));
    expect(normTitle('сделать 2 000 рассылок')).toBe(normTitle('сделать 2000 рассылок'));
  });

  it('разные числа НЕ схлопываются: «50 сделок» !== «200 встреч»', () => {
    expect(normTitle('50 сделок')).not.toBe(normTitle('200 встреч'));
  });

  it('срезает «(скобочные)» уточнения и пунктуацию, lowercase', () => {
    expect(normTitle('Набрать команду (3 чел)!')).toBe('набрать команду');
    expect(normTitle('«Выйти на 100 клиентов»')).toBe('выйти на 100 клиентов');
  });
});

describe('agent-scoring · scoreExtraction', () => {
  const golden: GoldenTask[] = [
    { title: 'Выйти на 100 платящих клиентов в месяц', keyFacts: ['100'] },
    { title: 'Провести 10 встреч-презентаций в неделю', keyFacts: ['10'] },
    { title: 'Сделать 500 холодных рассылок', keyFacts: ['500'] },
  ];

  it('3 верных задачи (с keyFacts) → completeness=1.0, precision=1.0, dupeRate=0', () => {
    const extracted = [
      'Выйти на 100 платящих клиентов в месяц',
      'Провести 10 встреч-презентаций в неделю',
      'Сделать 500 холодных рассылок',
    ];
    const s = scoreExtraction(golden, extracted);
    expect(s.completeness).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.dupeRate).toBe(0);
    expect(s.matched).toBe(3);
    expect(s.missing).toEqual([]);
    expect(s.spurious).toEqual([]);
  });

  it('дубль «рассылка 2000» + «рассылка 2 000» → dupeRate > 0', () => {
    const g: GoldenTask[] = [{ title: 'Сделать рассылку 2000', keyFacts: ['2000'] }];
    const extracted = ['Сделать рассылку 2000', 'Сделать рассылку 2 000'];
    const s = scoreExtraction(g, extracted);
    expect(s.dupeRate).toBeGreaterThan(0);
  });

  it('потеря числа (нет keyFact «100») → этот golden НЕ matched, completeness < 1', () => {
    const extracted = [
      // «стопящих» вместо 100 — конкретика потеряна, keyFact «100» отсутствует.
      'Выйти на стопящих платящих клиентов в месяц',
      'Провести 10 встреч-презентаций в неделю',
      'Сделать 500 холодных рассылок',
    ];
    const s = scoreExtraction(golden, extracted);
    expect(s.completeness).toBeLessThan(1);
    expect(s.missing).toContain('Выйти на 100 платящих клиентов в месяц');
  });

  it('NEGATIVE: лишняя выдуманная задача → precision < 1, spurious не пуст', () => {
    const extracted = [
      'Выйти на 100 платящих клиентов в месяц',
      'Провести 10 встреч-презентаций в неделю',
      'Сделать 500 холодных рассылок',
      'Купить новый кофейный аппарат в офис', // выдумано, нет в golden
    ];
    const s = scoreExtraction(golden, extracted);
    expect(s.completeness).toBe(1); // все эталонные найдены
    expect(s.precision).toBeLessThan(1); // но есть лишняя
    expect(s.spurious).toContain('Купить новый кофейный аппарат в офис');
  });
});

describe('agent-scoring · scoreDecisions', () => {
  it('решение найдено → completeness=1', () => {
    const s = scoreDecisions(
      ['Ниша — консалтинговые компании'],
      ['Ниша — консалтинговые компании'],
    );
    expect(s.completeness).toBe(1);
  });

  it('решение не извлечено → completeness=0', () => {
    const s = scoreDecisions(['Ниша — консалтинговые компании'], []);
    expect(s.completeness).toBe(0);
    expect(s.missing).toContain('Ниша — консалтинговые компании');
  });
});

describe('agent-scoring · formatDelta', () => {
  it('без baseline — печатает пометку об отсутствии', () => {
    const out = formatDelta(null, []);
    expect(out).toContain('baseline отсутствует');
  });

  it('считает Δ метрик по совпадающим variant', () => {
    const perfect = scoreExtraction(
      [{ title: 'A', keyFacts: [] }],
      ['A'],
    );
    const empty = scoreExtraction([{ title: 'A', keyFacts: [] }], []);
    const prevVariant: VariantScore = {
      variant: 'clean',
      fixtures: 1,
      tasks: empty,
      decisions: empty,
    };
    const currVariant: VariantScore = {
      variant: 'clean',
      fixtures: 1,
      tasks: perfect,
      decisions: perfect,
    };
    const out = formatDelta(
      { generatedAt: 'x', variants: [prevVariant] },
      [currVariant],
    );
    expect(out).toContain('[clean]');
    expect(out).toContain('Δcompleteness +1.000');
  });
});
