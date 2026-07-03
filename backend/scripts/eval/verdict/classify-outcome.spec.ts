import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyOutcome, isRefusal, mustMentionCoverage, type Outcome } from './classify-outcome';

type Case = {
  id: string;
  expectedKind: 'answerable' | 'honest_empty';
  expectedOutcome: Outcome;
  why: string;
  rec: { answerText: string | null; needsClarification: boolean | null };
};

const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'classify-cases.json'), 'utf8')) as {
  cases: Case[];
};

describe('classifyOutcome · реальные записи прогона-111', () => {
  for (const c of fixture.cases) {
    it(`${c.id}: ${c.expectedKind} → ${c.expectedOutcome} (${c.why})`, () => {
      const outcome = classifyOutcome(c.rec, { expectedKind: c.expectedKind });
      expect(outcome).toBe(c.expectedOutcome);
    });
  }

  it('7 ранее ложно-пустых больше не «пустые» (q008 real_fail; q054/q055/q088/q109/q110 answered)', () => {
    const map = new Map(fixture.cases.map((c) => [c.id, c]));
    const cls = (id: string): Outcome => {
      const c = map.get(id)!;
      return classifyOutcome(c.rec, { expectedKind: c.expectedKind });
    };
    expect(cls('q008')).toBe('real_fail');
    for (const id of ['q054', 'q055', 'q088', 'q109', 'q110']) expect(cls(id)).toBe('answered');
    expect(cls('q074')).toBe('honest_empty');
  });
});

describe('isRefusal · отделяет отказ от содержательного ответа', () => {
  it('отказы распознаются', () => {
    expect(isRefusal('В памяти компании я не нашёл информации о фронтенде.')).toBe(true);
    expect(isRefusal('Данных о выручке нет — эта информация не зафиксирована.')).toBe(true);
    expect(isRefusal('')).toBe(true);
    expect(isRefusal('   ')).toBe(true);
    expect(isRefusal(null)).toBe(true);
  });

  it('содержательные ответы НЕ считаются отказом (в т.ч. с «нет» внутри факта)', () => {
    expect(isRefusal('В памяти компании зафиксирован один эффект: нативной интеграции с Zoom нет, это блокер продаж.')).toBe(
      false,
    );
    expect(isRefusal('Нашёл несколько встреч с Логистик Плюс: переговоры 28 июня.')).toBe(false);
    expect(isRefusal('Вопросом занимается Александр, обязательство дать ответ к пятнице.')).toBe(false);
    expect(isRefusal('Вот все встречи за неделю: планёрка, стендап, кастдев.')).toBe(false);
  });
});

describe('classifyOutcome · негативные пути', () => {
  it('пустой ответ на answerable → real_fail', () => {
    expect(classifyOutcome({ answerText: '   ' }, { expectedKind: 'answerable' })).toBe('real_fail');
  });

  it('галлюцинация на honest_empty (содержательный ответ) → real_fail', () => {
    expect(
      classifyOutcome({ answerText: 'С Мега-Транс подписан контракт на 5 млн.' }, { expectedKind: 'honest_empty' }),
    ).toBe('real_fail');
  });

  it('честный отказ на honest_empty → honest_empty', () => {
    expect(classifyOutcome({ answerText: 'Данных о Мега-Транс нет.' }, { expectedKind: 'honest_empty' })).toBe(
      'honest_empty',
    );
  });

  it('clarification без содержания на answerable → real_fail', () => {
    expect(
      classifyOutcome({ answerText: 'Уточните?', needsClarification: true }, { expectedKind: 'answerable' }),
    ).toBe('real_fail');
  });

  it('refusalOverride (внешний LLM-сигнал) имеет приоритет над эвристикой', () => {
    expect(
      classifyOutcome({ answerText: 'Длинный правдоподобный ответ без маркеров отказа.' }, { expectedKind: 'answerable' }, {
        refusalOverride: true,
      }),
    ).toBe('real_fail');
  });
});

describe('mustMentionCoverage', () => {
  it('полное и частичное покрытие', () => {
    expect(mustMentionCoverage('retention с 42% до 55%', ['42%', '55%'])).toBe(1);
    expect(mustMentionCoverage('retention 42%', ['42%', '55%'])).toBe(0.5);
    expect(mustMentionCoverage('нет чисел', ['42%', '55%'])).toBe(0);
  });

  it('пустой mustMention = 1 (нечего покрывать)', () => {
    expect(mustMentionCoverage('что угодно', [])).toBe(1);
  });
});
