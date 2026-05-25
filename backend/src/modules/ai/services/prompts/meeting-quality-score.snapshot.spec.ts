/**
 * Snapshot-тест сборки промта `meeting-quality-score.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `MEETING_QUALITY_SCORE_SYSTEM_PROMPT` (constant — guard от
 *     случайных правок шкалы/якорей);
 *   - текст user, который собирает `buildMeetingQualityScoreUserPrompt`
 *     для фикстуры с метриками поведения и без них.
 *
 * Обновлять только при осознанном изменении промта: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  buildMeetingQualityScoreUserPrompt,
  MEETING_QUALITY_SCORE_SYSTEM_PROMPT,
} from './meeting-quality-score';

const FIXTURE_TRANSCRIPT_CONDENSED = [
  '--- фрагмент [00:00–10:00] ---',
  '[Алиса @00:00] Тема встречи — планы на спринт.',
  '[Боб @00:15] Я подготовил список рисков.',
  '--- фрагмент [50:00–60:00] ---',
  '[Алиса @58:30] Итог: фичу A берём, B — в следующий спринт.',
].join('\n');

describe('meeting-quality-score — snapshot сборки промта', () => {
  it('system prompt стабилен (константа MEETING_QUALITY_SCORE_SYSTEM_PROMPT)', () => {
    expect(MEETING_QUALITY_SCORE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('user prompt стабилен без метрик поведения', () => {
    const user = buildMeetingQualityScoreUserPrompt({
      meetingType: 'team',
      durationMinutes: 60,
      participantsCount: 4,
      transcriptCondensed: FIXTURE_TRANSCRIPT_CONDENSED,
    });
    expect(user).toMatchSnapshot('user-without-metrics');
  });

  it('user prompt стабилен с метриками поведения (silence/dominance/topSpeakers)', () => {
    const user = buildMeetingQualityScoreUserPrompt({
      meetingType: 'standup',
      durationMinutes: 25,
      participantsCount: 5,
      transcriptCondensed: FIXTURE_TRANSCRIPT_CONDENSED,
      silencePercent: 18,
      dominanceIndex: 2.4,
      topSpeakers: ['Алиса — 38%', 'Боб — 25%', 'Вика — 18%'],
    });
    expect(user).toMatchSnapshot('user-with-metrics');
  });
});
