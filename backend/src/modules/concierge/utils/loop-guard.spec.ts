import { describe, expect, it } from 'vitest';

import { LoopGuard, fingerprint } from './loop-guard';

describe('LoopGuard', () => {
  it('первый запрос пропущен', () => {
    const g = new LoopGuard();
    expect(g.firstTime('встреча Александр')).toBe(true);
  });

  it('тот же запрос заблокирован', () => {
    const g = new LoopGuard();
    g.firstTime('встреча Александр');
    expect(g.firstTime('встреча Александр')).toBe(false);
  });

  it('тот же запрос с другим регистром/пунктуацией — тоже заблокирован', () => {
    const g = new LoopGuard();
    g.firstTime('встреча Александр');
    expect(g.firstTime('Встреча, Александр!')).toBe(false);
  });

  it('другой запрос пропущен', () => {
    const g = new LoopGuard();
    g.firstTime('встреча Александр');
    expect(g.firstTime('боли Александра')).toBe(true);
  });

  it('счётчик срабатываний считает только повторы', () => {
    const g = new LoopGuard();
    g.firstTime('встреча Александр');
    g.firstTime('встреча Александр');
    g.firstTime('Встреча, Александр!');
    g.firstTime('боли Александра');
    expect(g.hitCount).toBe(2);
  });

  it('отпечаток нормализует регистр/пунктуацию', () => {
    expect(fingerprint('Встреча, Александр!')).toBe(fingerprint('встреча александр'));
  });
});
