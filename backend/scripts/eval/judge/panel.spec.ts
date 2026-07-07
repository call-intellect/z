import { describe, expect, it, vi } from 'vitest';

import {
  aggregateVotes,
  buildUser,
  judgeOne,
  parseVerdict,
  type LensVerdict,
  type LlmCall,
  type Vote,
} from './panel';

const v = (lens: Vote['lens'], verdict: LensVerdict): Vote => ({ lens, verdict, reason: '' });

describe('aggregateVotes · большинство из 3', () => {
  it('2 из 3 correct → correct', () => {
    const r = aggregateVotes([v('literal', 'correct'), v('coverage', 'correct'), v('honesty', 'incorrect')]);
    expect(r.verdict).toBe('correct');
    expect(r.agree).toBe(2);
    expect(r.total).toBe(3);
  });

  it('1 из 3 correct → incorrect', () => {
    const r = aggregateVotes([v('literal', 'correct'), v('coverage', 'incorrect'), v('honesty', 'incorrect')]);
    expect(r.verdict).toBe('incorrect');
    expect(r.agree).toBe(2);
  });

  it('единогласие фиксируется в agree', () => {
    const r = aggregateVotes([v('literal', 'correct'), v('coverage', 'correct'), v('honesty', 'correct')]);
    expect(r.verdict).toBe('correct');
    expect(r.agree).toBe(3);
  });
});

describe('judgeOne · 3 линзы, мок LLM (детерминизм, без сети)', () => {
  it('линзы голосуют → мажоритарный вердикт', async () => {
    const call: LlmCall = vi.fn(async (system: string) => {
      if (system.includes('честности')) return { verdict: 'incorrect', reason: 'выдумка' };
      return { verdict: 'correct', reason: 'ок' };
    });
    const r = await judgeOne(
      { question: 'Q', answerText: 'A' },
      { mustMention: ['x'], expectedKind: 'answerable' },
      call,
    );
    expect(call).toHaveBeenCalledTimes(3);
    expect(r.verdict).toBe('correct');
    expect(r.votes.find((x) => x.lens === 'honesty')?.verdict).toBe('incorrect');
  });

  it('null-голос LLM трактуется как incorrect', async () => {
    const call: LlmCall = vi.fn(async () => null);
    const r = await judgeOne({ question: 'Q', answerText: 'A' }, { mustMention: [], expectedKind: 'answerable' }, call);
    expect(r.verdict).toBe('incorrect');
    expect(r.votes.every((x) => x.reason === 'llm-null')).toBe(true);
  });
});

describe('buildUser · gold передаётся, не хардкодится', () => {
  it('промпт включает эталон, mustMention и тип', () => {
    const u = buildUser(
      { question: 'Какая цель?', answerText: 'retention 42→55' },
      { expectedAnswer: 'retention 42→55%', mustMention: ['42%', '55%'], expectedKind: 'answerable' },
    );
    expect(u).toContain('retention 42→55%');
    expect(u).toContain('42%');
    expect(u).toContain('answerable');
    expect(u).toContain('retention 42→55');
  });
});

describe('parseVerdict · «incorrect» не путается с «correct»', () => {
  it('incorrect ловится раньше correct (подстрока)', () => {
    expect(parseVerdict('incorrect')).toBe('incorrect');
    expect(parseVerdict('correct')).toBe('correct');
    expect(parseVerdict('Неверно')).toBe('incorrect');
    expect(parseVerdict('верно')).toBe('correct');
    expect(parseVerdict('мусор')).toBe('incorrect');
  });
});
