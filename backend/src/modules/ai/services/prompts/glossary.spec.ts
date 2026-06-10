import { describe, expect, it } from 'vitest';

import { withGlossary } from './glossary';

describe('withGlossary', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки сущности.';

  it('вставляет блок «Глоссарий бизнес-терминов:» с нужными определениями', () => {
    const out = withGlossary(SYSTEM, ['pain', 'churn_risk']);
    expect(out).toContain(SYSTEM);
    expect(out).toContain('Глоссарий бизнес-терминов:');
    expect(out).toContain('Pain —');
    expect(out).toContain('Churn risk —');
    // Только запрошенные — других не подмешиваем.
    expect(out).not.toContain('Commitment —');
    expect(out).not.toContain('Mentoring —');
  });

  it('неизвестный термин silently skip (тип — кастуем через unknown для негативного кейса)', () => {
    const out = withGlossary(SYSTEM, [
      'pain',
      'nonexistent_term' as unknown as 'pain',
    ]);
    expect(out).toContain('Pain —');
    // Промт остался корректным — никаких «- undefined» / «- nonexistent».
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('nonexistent_term');
  });

  it('пустой массив терминов — возвращает system без изменений', () => {
    const out = withGlossary(SYSTEM, []);
    expect(out).toBe(SYSTEM);
    expect(out).not.toContain('Глоссарий бизнес-терминов:');
  });

  it('только неизвестные термины — возвращает system без раздела глоссария', () => {
    const out = withGlossary(SYSTEM, [
      'nope' as unknown as 'pain',
      'also_nope' as unknown as 'pain',
    ]);
    expect(out).toBe(SYSTEM);
    expect(out).not.toContain('Глоссарий бизнес-терминов:');
  });

  it('каждое определение оформлено маркером «- » (защита от regression форматирования)', () => {
    const out = withGlossary(SYSTEM, ['decision', 'regulation']);
    expect(out).toMatch(/\n- Decision —/);
    expect(out).toMatch(/\n- Regulation —/);
  });

  it('process-discriminator (A0.4) — известный ключ, подмешивается определение', () => {
    const out = withGlossary(SYSTEM, ['process-discriminator']);
    expect(out).toContain('Глоссарий бизнес-терминов:');
    expect(out).toContain('Процесс/норма —');
    expect(out).toContain('Разовое НЕ создаёт регламент');
  });
});
