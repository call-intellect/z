import { describe, expect, it } from 'vitest';

import {
  SENTIMENT_VISIBLE_ROLES,
  stripSentimentForRole,
  type DailyCheckInDto,
} from './daily-check-in.dto';

describe('stripSentimentForRole', () => {
  function buildDto(): DailyCheckInDto {
    return {
      id: 'cin1',
      tenantId: 't1',
      personId: 'p1',
      kind: 'evening',
      dateLocal: '2026-05-23',
      plans: [],
      dones: [],
      blockers: [],
      notificationId: null,
      parseConfidence: 1,
      curatorReview: false,
      completedAt: '2026-05-23T18:30:00Z',
      createdAt: '2026-05-23T18:30:00Z',
      updatedAt: '2026-05-23T18:30:00Z',
      source: 'cron_prompted',
      sentiment: 'red',
      sentimentRationale: 'выгорание',
      sentimentVersion: 'prompt-v1+deepseek',
      sentimentDeterminedAt: '2026-05-23T18:31:00Z',
    };
  }

  it('coo: поля настроения видны', () => {
    const result = stripSentimentForRole(buildDto(), 'coo');
    expect(result.sentiment).toBe('red');
    expect(result.sentimentRationale).toBe('выгорание');
  });

  it('owner: поля настроения видны', () => {
    const result = stripSentimentForRole(buildDto(), 'owner');
    expect(result.sentiment).toBe('red');
  });

  it('admin: поля настроения видны', () => {
    const result = stripSentimentForRole(buildDto(), 'admin');
    expect(result.sentiment).toBe('red');
  });

  it('super_admin: поля настроения видны', () => {
    const result = stripSentimentForRole(buildDto(), 'super_admin');
    expect(result.sentiment).toBe('red');
  });

  it('member: поля настроения отсутствуют', () => {
    const result = stripSentimentForRole(buildDto(), 'member');
    expect('sentiment' in result).toBe(false);
    expect('sentimentRationale' in result).toBe(false);
    expect('sentimentVersion' in result).toBe(false);
    expect('sentimentDeterminedAt' in result).toBe(false);
  });

  it('manager: поля настроения отсутствуют', () => {
    const result = stripSentimentForRole(buildDto(), 'manager');
    expect('sentiment' in result).toBe(false);
  });

  it('null (без роли): поля настроения отсутствуют — fail-safe для /me/check-ins', () => {
    const result = stripSentimentForRole(buildDto(), null);
    expect('sentiment' in result).toBe(false);
    expect('sentimentRationale' in result).toBe(false);
  });

  it('whitelist: только 4 роли', () => {
    expect(Array.from(SENTIMENT_VISIBLE_ROLES).sort()).toEqual([
      'admin',
      'coo',
      'owner',
      'super_admin',
    ]);
  });

  it('не мутирует исходный DTO', () => {
    const original = buildDto();
    const before = JSON.stringify(original);
    stripSentimentForRole(original, 'member');
    expect(JSON.stringify(original)).toBe(before);
  });
});
