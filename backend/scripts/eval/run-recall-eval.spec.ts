import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { evaluateCorpus, renderReport, type EvalResult, type GoldQ, type ResultRec } from './run-recall-eval';

const gold = (JSON.parse(readFileSync(join(__dirname, 'gold', 'recall-gold.json'), 'utf8')) as { questions: GoldQ[] })
  .questions;
const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'results-gold-subset.json'), 'utf8')) as {
  results: ResultRec[];
};

describe('run-recall-eval · сухой прогон на замороженной фикстуре (БЕЗ стенда/судьи)', () => {
  let res: EvalResult;
  const outcomeOf = (id: string): string => res.rows.find((r) => r.id === id)?.outcome ?? 'MISSING';

  beforeAll(async () => {
    res = await evaluateCorpus({ results: fixture.results, gold, judgeCall: null });
  });

  it('все gold-вопросы нашлись в результатах', () => {
    expect(res.missing).toEqual([]);
    expect(res.rows.length).toBe(gold.length);
  });

  it('ранее ложно-пустые классифицируются верно: q008→real_fail; q054/q055/q088→answered; q068/q074→honest_empty', () => {
    expect(outcomeOf('q008')).toBe('real_fail');
    expect(outcomeOf('q054')).toBe('answered');
    expect(outcomeOf('q055')).toBe('answered');
    expect(outcomeOf('q088')).toBe('answered');
    expect(outcomeOf('q068')).toBe('honest_empty');
    expect(outcomeOf('q074')).toBe('honest_empty');
  });

  it('сломанный флаг харнесса подтверждён: у q054/q055/q088 oldHonest=true, но классификатор даёт answered', () => {
    for (const id of ['q054', 'q055', 'q088']) {
      const rec = fixture.results.find((r) => r.id === id)!;
      expect(rec.oldHonest, `${id}: oldHonest`).toBe(true);
      expect(outcomeOf(id)).toBe('answered');
    }
  });

  it('постадийные метрики посчитаны: retrievalRecall в [0,1]', () => {
    expect(res.aggregate.retrievalRecall).not.toBeNull();
    expect(res.aggregate.retrievalRecall as number).toBeGreaterThanOrEqual(0);
    expect(res.aggregate.retrievalRecall as number).toBeLessThanOrEqual(1);
    expect(res.aggregate.faithfulness).toBeNull();
  });

  it('honest_empty не получают retrievalRecall (нечего искать)', () => {
    const empties = res.rows.filter((r) => r.expectedKind === 'honest_empty');
    expect(empties.length).toBeGreaterThanOrEqual(3);
    for (const e of empties) expect(e.retrievalRecall).toBeNull();
  });

  it('отчёт содержит секции исхода, постадийных метрик и реальных провалов', () => {
    const md = renderReport(res, { runId: 'test', source: 'fixture', judged: false });
    expect(md).toContain('## Исход');
    expect(md).toContain('реальный провал');
    expect(md).toContain('## Постадийно');
    expect(md).toContain('## Реальные провалы');
    expect(md).toContain('нужен судья');
  });
});
