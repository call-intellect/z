/**
 * Unit-тесты для алгоритма condenseTranscriptForQualityScore() (sub-TZ C §5.3).
 *
 * Источник: plans/tz/2026-05-21-phase-C-meeting-quality-score.md §5.3.
 *
 * Контракт:
 *   - duration ≤ 30 мин   → весь транскрипт без сегментирования.
 *   - 30 < duration ≤ 120 → 1 head (10 мин) + 5 random (по 2 мин) + 1 tail (10 мин).
 *   - duration > 120      → 1 head (10 мин) + 10 random (по 2 мин) + 1 tail (10 мин).
 *
 * Также проверяем устойчивость к пустому транскрипту.
 */

import { describe, expect, it } from 'vitest';

import type { DialogTurn } from './common';
import {
  MEETING_QUALITY_SCORE_SCHEMA,
  condenseTranscriptForQualityScore,
} from './meeting-quality-score';

function buildTurns(durationSec: number, intervalSec = 5): DialogTurn[] {
  const turns: DialogTurn[] = [];
  for (let t = 0; t + intervalSec <= durationSec; t += intervalSec) {
    turns.push({
      speaker: t % 2 === 0 ? 'Алиса' : 'Боб',
      text: `реплика на секунде ${t}`,
      startSec: t,
      endSec: t + intervalSec,
    });
  }
  return turns;
}

describe('condenseTranscriptForQualityScore — §5.3', () => {
  it('короткая встреча (15 мин) — выдаёт весь транскрипт без маркеров фрагментов', () => {
    const turns = buildTurns(15 * 60);
    const out = condenseTranscriptForQualityScore(turns, { durationMs: 15 * 60 * 1000 });
    expect(out).not.toContain('--- фрагмент');
    // Должны быть и первый, и последний turns в выводе.
    expect(out).toContain('реплика на секунде 0');
    expect(out).toContain(`реплика на секунде ${15 * 60 - 5}`);
  });

  it('средняя встреча (60 мин) — head + ~5 random + tail (сегментирована)', () => {
    const turns = buildTurns(60 * 60);
    const out = condenseTranscriptForQualityScore(turns, { durationMs: 60 * 60 * 1000 });
    expect(out).toContain('--- фрагмент');
    // Head: реплика в начале (секунда 0).
    expect(out).toContain('реплика на секунде 0');
    // Tail: реплика близко к концу (например 59-я минута).
    expect(out).toContain('реплика на секунде 3590');
    // Сегментов после merge — между 2 и 7 (head + до 5 random + tail; перекрытия объединяются).
    const fragmentCount = (out.match(/--- фрагмент/g) ?? []).length;
    expect(fragmentCount).toBeGreaterThanOrEqual(2);
    expect(fragmentCount).toBeLessThanOrEqual(7);
  });

  it('длинная встреча (180 мин) — head + ~10 random + tail', () => {
    const turns = buildTurns(180 * 60, 10);
    const out = condenseTranscriptForQualityScore(turns, { durationMs: 180 * 60 * 1000 });
    expect(out).toContain('--- фрагмент');
    expect(out).toContain('реплика на секунде 0');
    // Tail должен содержать реплику близко к концу.
    expect(out).toContain('реплика на секунде 10790');
    const fragmentCount = (out.match(/--- фрагмент/g) ?? []).length;
    // head + до 10 random + tail = до 12 сегментов; после merge — меньше, но > 3.
    expect(fragmentCount).toBeGreaterThanOrEqual(3);
    expect(fragmentCount).toBeLessThanOrEqual(12);
  });

  it('пустой транскрипт → плейсхолдер', () => {
    const out = condenseTranscriptForQualityScore([], { durationMs: 0 });
    expect(out).toBe('(транскрипт пуст)');
  });
});

describe('MEETING_QUALITY_SCORE_SCHEMA — валидация ответа LLM', () => {
  it('принимает валидный объект', () => {
    const sample = {
      overallScore: 72,
      categories: {
        preparation: 70,
        structure: 80,
        clarity: 65,
        outcomes: 75,
        engagement: 70,
      },
      recommendations: [
        {
          text: 'Озвучить повестку в первые 5 минут.',
          severity: 'warning',
          category: 'preparation',
        },
      ],
      strengths: ['Чёткие итоги по задачам.'],
    };
    expect(MEETING_QUALITY_SCORE_SCHEMA.safeParse(sample).success).toBe(true);
  });

  it('отклоняет overallScore вне 0..100', () => {
    const bad = {
      overallScore: 150,
      categories: {
        preparation: 70,
        structure: 80,
        clarity: 65,
        outcomes: 75,
        engagement: 70,
      },
      recommendations: [{ text: 'x', severity: 'info', category: 'structure' }],
      strengths: [],
    };
    expect(MEETING_QUALITY_SCORE_SCHEMA.safeParse(bad).success).toBe(false);
  });

  it('отклоняет неизвестный severity', () => {
    const bad = {
      overallScore: 60,
      categories: {
        preparation: 60,
        structure: 60,
        clarity: 60,
        outcomes: 60,
        engagement: 60,
      },
      recommendations: [
        { text: 'x', severity: 'urgent', category: 'structure' },
      ],
      strengths: [],
    };
    expect(MEETING_QUALITY_SCORE_SCHEMA.safeParse(bad).success).toBe(false);
  });
});
