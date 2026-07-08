import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  emptyPersonalDayNarrativeDto,
  type DayLetterQuery,
} from '../dto/personal-day-narrative.dto';
import type { PersonalDayNarrativeService } from '../services/personal-day-narrative.service';
import type { SelfPersonResolverService } from '../services/self-person-resolver.service';

import { MyDayNarrativeController } from './my-day-narrative.controller';

describe('MyDayNarrativeController.getDayLetter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('без q.date дефолтит dateLocal на вчера по МСК', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T05:00:00.000Z'));

    const getForPerson = vi.fn().mockResolvedValue(emptyPersonalDayNarrativeDto('2026-07-07'));
    const resolveSelfPerson = vi.fn().mockResolvedValue({ id: 'p1' });

    const selfPerson = { resolveSelfPerson } as unknown as SelfPersonResolverService;
    const narratives = { getForPerson } as unknown as PersonalDayNarrativeService;
    const controller = new MyDayNarrativeController(selfPerson, narratives);

    const req = { user: { id: 'u1' } } as unknown as Request;
    await controller.getDayLetter('t1', req, {} as DayLetterQuery);

    expect(getForPerson).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', personId: 'p1', dateLocal: '2026-07-07' }),
    );
  });

  it('явный q.date проходит как есть', async () => {
    const getForPerson = vi.fn().mockResolvedValue(emptyPersonalDayNarrativeDto('2026-01-01'));
    const resolveSelfPerson = vi.fn().mockResolvedValue({ id: 'p1' });

    const selfPerson = { resolveSelfPerson } as unknown as SelfPersonResolverService;
    const narratives = { getForPerson } as unknown as PersonalDayNarrativeService;
    const controller = new MyDayNarrativeController(selfPerson, narratives);

    const req = { user: { id: 'u1' } } as unknown as Request;
    await controller.getDayLetter('t1', req, { date: '2026-01-01' } as DayLetterQuery);

    expect(getForPerson).toHaveBeenCalledWith(
      expect.objectContaining({ dateLocal: '2026-01-01' }),
    );
  });
});
