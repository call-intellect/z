import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IngestService } from '../../ingest/ingest.service';

import {
  CheckinIngestService,
  checkinOccurredAt,
  extractCheckinItems,
  renderCheckinText,
} from './checkin-ingest.service';

function makeService(
  over: {
    prisma?: Partial<Record<string, unknown>>;
    ingest?: Partial<IngestService>;
  } = {},
): {
  service: CheckinIngestService;
  prisma: any;
  ingest: any;
} {
  const prisma = {
    dailyCheckIn: { findFirst: vi.fn() },
    person: { findFirst: vi.fn() },
    source: { findUnique: vi.fn(), create: vi.fn() },
    ...over.prisma,
  };
  const ingest = { ingest: vi.fn(), ...over.ingest };
  const service = new CheckinIngestService(
    prisma as unknown as PrismaService,
    ingest as unknown as IngestService,
  );
  return { service, prisma, ingest };
}

describe('extractCheckinItems', () => {
  it('массив объектов с text → пункты; severity сохранён у блокеров', () => {
    expect(
      extractCheckinItems([
        { text: 'Доделать отчёт', priority: 1 },
        { text: '  Созвон с клиентом  ' },
        { text: 'Прод упал', severity: 'high' },
      ]),
    ).toEqual([
      { text: 'Доделать отчёт' },
      { text: 'Созвон с клиентом' },
      { text: 'Прод упал', severity: 'high' },
    ]);
  });

  it('не-массив / элементы без строкового text / пустые строки → отфильтрованы', () => {
    expect(extractCheckinItems(null)).toEqual([]);
    expect(extractCheckinItems('строка')).toEqual([]);
    expect(extractCheckinItems([{ text: '' }, { text: '   ' }, { foo: 'bar' }, 42, null])).toEqual(
      [],
    );
  });
});

describe('renderCheckinText', () => {
  it('структурный чек-ин → заголовок + секции План/Сделано/Блокеры', () => {
    const out = renderCheckinText({
      personName: 'Иван Петров',
      dateLocal: '2026-06-10',
      kind: 'evening',
      plans: [{ text: 'Подготовить КП' }],
      dones: [{ text: 'Отправил КП' }],
      blockers: [{ text: 'Нет доступа к CRM', severity: 'high' }],
      rawResponseText: 'сырой текст не нужен',
    });
    expect(out).toContain('Чек-ин сотрудника Иван Петров, 2026-06-10, вечерний отчёт.');
    expect(out).toContain('План на день:\n- Подготовить КП');
    expect(out).toContain('Сделано:\n- Отправил КП');
    expect(out).toContain('Блокеры:\n- Нет доступа к CRM (важность: высокая)');
    expect(out).not.toContain('сырой текст не нужен');
  });

  it('утренний план → корректный лейбл', () => {
    const out = renderCheckinText({
      personName: 'Иван',
      dateLocal: '2026-06-10',
      kind: 'morning',
      plans: [{ text: 'Спринт-планирование' }],
      dones: [],
      blockers: [],
      rawResponseText: null,
    });
    expect(out).toContain('утренний план.');
  });

  it('пустая структура (низкая уверенность парсера, Р-B1) → тело = rawResponseText', () => {
    const out = renderCheckinText({
      personName: 'Иван',
      dateLocal: '2026-06-10',
      kind: 'evening',
      plans: [],
      dones: [],
      blockers: [],
      rawResponseText: 'Сегодня закрыл сделку с Ромашкой, завтра демо',
    });
    expect(out).toContain('Чек-ин сотрудника Иван, 2026-06-10, вечерний отчёт.');
    expect(out).toContain('Сегодня закрыл сделку с Ромашкой, завтра демо');
    expect(out).not.toContain('План на день:');
  });
});

describe('checkinOccurredAt', () => {
  it('валидный dateLocal → полдень UTC того дня (стабилен, не зависит от completedAt)', () => {
    const fallback = new Date('2030-01-01T00:00:00.000Z');
    expect(checkinOccurredAt('2026-06-10', fallback)).toEqual(new Date('2026-06-10T12:00:00.000Z'));
  });

  it('невалидный dateLocal → fallback (completedAt)', () => {
    const fallback = new Date('2026-06-10T18:30:00.000Z');
    expect(checkinOccurredAt('нет даты', fallback)).toBe(fallback);
  });
});

describe('CheckinIngestService.ingestCheckin', () => {
  it('completedAt=null → null, ingest НЕ вызван (R2)', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      id: 'ci1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-10',
      plansJson: null,
      donesJson: null,
      blockersJson: null,
      rawResponseText: null,
      curatorReview: false,
      completedAt: null,
    });

    const out = await service.ingestCheckin('t1', 'ci1');

    expect(out).toBeNull();
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('чек-ин не найден → null, ingest НЕ вызван', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.dailyCheckIn.findFirst.mockResolvedValue(null);

    const out = await service.ingestCheckin('t1', 'missing');

    expect(out).toBeNull();
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('завершённый структурный чек-ин → ingest(daily_checkin, sensitive, checkInId, turns.authorPersonId, occurredAt из dateLocal); без sentiment/quality', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      id: 'ci1',
      personId: 'p1',
      kind: 'evening',
      dateLocal: '2026-06-10',
      plansJson: [{ text: 'Подготовить КП' }],
      donesJson: [{ text: 'Отправил КП' }],
      blockersJson: [{ text: 'Нет доступа', severity: 'medium' }],
      rawResponseText: 'raw',
      curatorReview: false,
      completedAt: new Date('2026-06-10T18:45:00.000Z'),
    });
    prisma.person.findFirst.mockResolvedValue({ name: 'Иван Петров' });
    prisma.source.findUnique.mockResolvedValue({ id: 'src1' });
    ingest.ingest.mockResolvedValue({
      rawEvent: { id: 're1' },
      idempotent: false,
    });

    const out = await service.ingestCheckin('t1', 'ci1');

    expect(out).toEqual({ rawEventId: 're1' });
    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        sourceId: 'src1',
        sourceExternalId: 'ci1',
        dataClass: 'sensitive',
        occurredAt: new Date('2026-06-10T12:00:00.000Z'),
        payload: expect.objectContaining({
          kind: 'daily_checkin',
          checkInId: 'ci1',
          personId: 'p1',
          fullText: expect.stringContaining('План на день:\n- Подготовить КП'),
          transcript: expect.objectContaining({
            turns: [
              expect.objectContaining({
                authorPersonId: 'p1',
                speaker: 'Иван Петров',
              }),
            ],
          }),
        }),
      }),
    );
    const payload = (ingest.ingest.mock.calls[0]![0] as { payload: any }).payload;
    expect(payload).not.toHaveProperty('sentiment');
    expect(payload).not.toHaveProperty('sentimentRationale');
    expect(payload).not.toHaveProperty('qualityScore');
    expect(payload.fullText).toContain('Блокеры:\n- Нет доступа (важность: средняя)');
  });

  it('curatorReview-чек-ин (пустая структура, есть rawResponseText) → ingest вызван, fullText = rawResponseText (R6)', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      id: 'ci2',
      personId: 'p2',
      kind: 'evening',
      dateLocal: '2026-06-10',
      plansJson: null,
      donesJson: null,
      blockersJson: null,
      rawResponseText: 'Закрыл сделку с Ромашкой, завтра демо',
      curatorReview: true,
      completedAt: new Date('2026-06-10T19:00:00.000Z'),
    });
    prisma.person.findFirst.mockResolvedValue({ name: 'Пётр' });
    prisma.source.findUnique.mockResolvedValue({ id: 'src1' });
    ingest.ingest.mockResolvedValue({
      rawEvent: { id: 're2' },
      idempotent: false,
    });

    const out = await service.ingestCheckin('t1', 'ci2');

    expect(out).toEqual({ rawEventId: 're2' });
    const payload = (ingest.ingest.mock.calls[0]![0] as { payload: any }).payload;
    expect(payload.fullText).toContain('Закрыл сделку с Ромашкой, завтра демо');
    expect(payload.curatorReview).toBe(true);
  });

  it('source отсутствует → create(type=daily_checkin, sensitive)', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      id: 'ci3',
      personId: 'p3',
      kind: 'morning',
      dateLocal: '2026-06-10',
      plansJson: [{ text: 'План' }],
      donesJson: null,
      blockersJson: null,
      rawResponseText: null,
      curatorReview: false,
      completedAt: new Date('2026-06-10T09:00:00.000Z'),
    });
    prisma.person.findFirst.mockResolvedValue({ name: 'Анна' });
    prisma.source.findUnique.mockResolvedValue(null);
    prisma.source.create.mockResolvedValue({ id: 'srcNew' });
    ingest.ingest.mockResolvedValue({
      rawEvent: { id: 're3' },
      idempotent: false,
    });

    await service.ingestCheckin('t1', 'ci3');

    expect(prisma.source.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
          type: 'daily_checkin',
          name: 'Ежедневные чек-ины',
          dataClass: 'sensitive',
          isActive: true,
        }),
      }),
    );
  });
});
