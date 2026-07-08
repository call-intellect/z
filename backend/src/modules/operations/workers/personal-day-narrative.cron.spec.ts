import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { PersonalDayNarrativeService } from '../services/personal-day-narrative.service';

import { PersonalDayNarrativeCron } from './personal-day-narrative.cron';

const PERSON = {
  id: 'p1',
  tenantId: 't1',
  userId: 'u1',
  name: 'Иван',
  timezone: 'Europe/Moscow',
};

function build(overrides?: { hour?: number; enabled?: boolean }) {
  const getOrGenerate = vi.fn().mockResolvedValue({ dateLocal: '2026-07-07', generated: true });
  const findMany = vi.fn().mockResolvedValue([PERSON]);
  const getDynamic = vi.fn(async (key: string) => {
    if (key === 'operations.personal_day_narrative.enabled') return overrides?.enabled ?? true;
    if (key === 'operations.personal_day_narrative.morning_hour') return overrides?.hour ?? 7;
    return undefined;
  });

  const prisma = { person: { findMany } } as unknown as PrismaService;
  const cfg = { getDynamic } as unknown as TypedConfigService;
  const narratives = { getOrGenerate } as unknown as PersonalDayNarrativeService;
  const cron = new PersonalDayNarrativeCron(prisma, cfg, narratives);
  return { cron, getOrGenerate, findMany };
}

describe('PersonalDayNarrativeCron', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('при локальном часе = morningHour зовёт getOrGenerate с packageRef = now - 24ч', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T04:30:00.000Z'));
    const { cron, getOrGenerate } = build();

    await cron.run();

    expect(getOrGenerate).toHaveBeenCalledTimes(1);
    expect(getOrGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        now: new Date('2026-07-08T04:30:00.000Z'),
        packageRef: new Date('2026-07-07T04:30:00.000Z'),
      }),
    );
  });

  it('при локальном часе ≠ morningHour не зовёт getOrGenerate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T10:00:00.000Z'));
    const { cron, getOrGenerate } = build();

    await cron.run();

    expect(getOrGenerate).not.toHaveBeenCalled();
  });

  it('при kill-switch OFF не читает persons', async () => {
    const { cron, getOrGenerate, findMany } = build({ enabled: false });

    await cron.run();

    expect(findMany).not.toHaveBeenCalled();
    expect(getOrGenerate).not.toHaveBeenCalled();
  });
});
