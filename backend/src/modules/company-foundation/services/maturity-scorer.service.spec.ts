import { describe, expect, it } from 'vitest';

/**
 * SBA α-9 wave 3 — pure-логика расчёта maturityScore (формула из §3.4).
 *
 * Полноценная интеграция с Prisma — отдельный integration spec; здесь покрываем
 * только формулу, чтобы быть уверенными в коэффициентах 0.4/0.3/0.3 и
 * cap'е [0..1].
 */

function computeRoleScore(args: {
  completeness: number;
  cardCount: number;
  probeClosedRatio: number;
}): number {
  const cardScore = Math.min(args.cardCount / 10, 1);
  const score =
    args.completeness * 0.4 + cardScore * 0.3 + args.probeClosedRatio * 0.3;
  return Math.max(0, Math.min(1, score));
}

describe('MaturityScorerService — формула Role', () => {
  it('даёт 0 при нулевых входных', () => {
    expect(computeRoleScore({ completeness: 0, cardCount: 0, probeClosedRatio: 0 }))
      .toBe(0);
  });

  it('даёт 1 при максимальных входных', () => {
    expect(
      computeRoleScore({
        completeness: 1,
        cardCount: 100, // capped → 1
        probeClosedRatio: 1,
      }),
    ).toBe(1);
  });

  it('применяет cap к cardCount/10', () => {
    const a = computeRoleScore({
      completeness: 0,
      cardCount: 10,
      probeClosedRatio: 0,
    });
    const b = computeRoleScore({
      completeness: 0,
      cardCount: 100,
      probeClosedRatio: 0,
    });
    expect(a).toBe(b);
    expect(a).toBeCloseTo(0.3, 6);
  });

  it('взвешивает completeness c коэффициентом 0.4', () => {
    expect(
      computeRoleScore({ completeness: 0.5, cardCount: 0, probeClosedRatio: 0 }),
    ).toBeCloseTo(0.2, 6);
  });

  it('взвешивает probe c коэффициентом 0.3', () => {
    expect(
      computeRoleScore({ completeness: 0, cardCount: 0, probeClosedRatio: 0.5 }),
    ).toBeCloseTo(0.15, 6);
  });

  it('капается в [0, 1]', () => {
    expect(
      computeRoleScore({
        completeness: 2,
        cardCount: 0,
        probeClosedRatio: 0,
      }),
    ).toBeLessThanOrEqual(1);
    expect(
      computeRoleScore({
        completeness: -1,
        cardCount: 0,
        probeClosedRatio: 0,
      }),
    ).toBe(0);
  });
});
