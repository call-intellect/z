import { describe, expect, it } from 'vitest';

import {
  buildMeetingSourceTitle,
  buildReportSourceTitle,
  formatEpisodeDate,
} from './episode-title.util';

describe('episode-title.util', () => {
  const date = new Date('2026-06-14T09:30:00.000Z');

  it('форматирует дату как DD.MM.YYYY (UTC)', () => {
    expect(formatEpisodeDate(date)).toBe('14.06.2026');
  });

  it('строит непустой заголовок встречи с названием и датой', () => {
    expect(buildMeetingSourceTitle({ title: 'Планёрка маркетинга', occurredAt: date })).toBe(
      'Встреча: Планёрка маркетинга, 14.06.2026',
    );
  });

  it('падает на дату-фолбэк, если у встречи нет названия', () => {
    expect(buildMeetingSourceTitle({ title: '   ', occurredAt: date })).toBe(
      'Встреча от 14.06.2026',
    );
    expect(buildMeetingSourceTitle({ title: null, occurredAt: date })).toBe(
      'Встреча от 14.06.2026',
    );
  });

  it('строит заголовок отчёта', () => {
    expect(buildReportSourceTitle({ title: 'Планёрка маркетинга', occurredAt: date })).toBe(
      'Отчёт встречи: Планёрка маркетинга, 14.06.2026',
    );
    expect(buildReportSourceTitle({ title: '', occurredAt: date })).toBe(
      'Отчёт встречи от 14.06.2026',
    );
  });
});
