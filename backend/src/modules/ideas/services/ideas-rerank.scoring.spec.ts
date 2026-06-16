import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IDEAS_RERANK_WEIGHTS,
  nextIdeaStatusOnTaskClose,
  rerankIdeas,
  scoreIdea,
  type IdeaRerankInput,
} from './ideas-rerank.scoring';

describe('ideas-rerank.scoring', () => {
  const now = new Date('2026-06-08T12:00:00.000Z');

  describe('scoreIdea', () => {
    it('бóльший weight → бóльший скор (при прочих равных)', () => {
      const base: IdeaRerankInput = {
        id: 'a',
        weight: 1,
        lastDiscussedAt: now,
        goalId: null,
      };
      const heavy: IdeaRerankInput = { ...base, id: 'b', weight: 10 };
      expect(scoreIdea(heavy, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30)).toBeGreaterThan(
        scoreIdea(base, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30),
      );
    });

    it('свежее обсуждение → выше, чем старое', () => {
      const fresh: IdeaRerankInput = {
        id: 'a',
        weight: 5,
        lastDiscussedAt: now,
        goalId: null,
      };
      const stale: IdeaRerankInput = {
        ...fresh,
        id: 'b',
        lastDiscussedAt: new Date('2026-04-01T00:00:00.000Z'),
      };
      expect(scoreIdea(fresh, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30)).toBeGreaterThan(
        scoreIdea(stale, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30),
      );
    });

    it('связь с целью даёт бонус', () => {
      const noGoal: IdeaRerankInput = {
        id: 'a',
        weight: 5,
        lastDiscussedAt: now,
        goalId: null,
      };
      const withGoal: IdeaRerankInput = { ...noGoal, id: 'b', goalId: 'g-1' };
      expect(scoreIdea(withGoal, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30)).toBeGreaterThan(
        scoreIdea(noGoal, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30),
      );
    });

    it('мусорный weight (NaN/отриц) → не падает, скор конечный', () => {
      const bad: IdeaRerankInput = {
        id: 'a',
        weight: Number.NaN,
        lastDiscussedAt: now,
        goalId: null,
      };
      const s = scoreIdea(bad, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30);
      expect(Number.isFinite(s)).toBe(true);
    });
  });

  describe('rerankIdeas', () => {
    it('сортирует по итоговому скору desc; цель+свежесть могут обогнать чистый weight', () => {
      const items: IdeaRerankInput[] = [
        {
          id: 'old-heavy',
          weight: 6,
          lastDiscussedAt: new Date('2026-03-01T00:00:00.000Z'),
          goalId: null,
        },
        {
          id: 'fresh-goal',
          weight: 5,
          lastDiscussedAt: now,
          goalId: 'g-1',
        },
      ];
      const ranked = rerankIdeas(items, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30);
      expect(ranked[0]?.item.id).toBe('fresh-goal');
      expect(ranked[1]?.item.id).toBe('old-heavy');
    });

    it('тай-брейкер стабилен (равный скор → по weight, затем id)', () => {
      const items: IdeaRerankInput[] = [
        { id: 'b', weight: 3, lastDiscussedAt: now, goalId: null },
        { id: 'a', weight: 3, lastDiscussedAt: now, goalId: null },
      ];
      const ranked = rerankIdeas(items, now, DEFAULT_IDEAS_RERANK_WEIGHTS, 30);
      expect(ranked.map((r) => r.item.id)).toEqual(['a', 'b']);
    });

    it('пустой список → пустой результат', () => {
      expect(rerankIdeas([], now)).toEqual([]);
    });
  });

  describe('nextIdeaStatusOnTaskClose', () => {
    it('captured → in_discussion (одна ступень)', () => {
      expect(nextIdeaStatusOnTaskClose('captured')).toBe('in_discussion');
    });

    it('in_progress → shipped (закрытие задачи = релиз)', () => {
      expect(nextIdeaStatusOnTaskClose('in_progress')).toBe('shipped');
    });

    it('accepted → in_progress', () => {
      expect(nextIdeaStatusOnTaskClose('accepted')).toBe('in_progress');
    });

    it('shipped → null (терминал)', () => {
      expect(nextIdeaStatusOnTaskClose('shipped')).toBeNull();
    });

    it('rejected/archived → null (не двигаем)', () => {
      expect(nextIdeaStatusOnTaskClose('rejected')).toBeNull();
      expect(nextIdeaStatusOnTaskClose('archived')).toBeNull();
    });
  });
});
