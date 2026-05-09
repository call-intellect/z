import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import {
  countWords,
  loadRoomChatForMerge,
  maxEndSec,
  mergeWordTimestamps,
  type PerTrackWords,
} from './merger';

describe('mergeWordTimestamps', () => {
  it('пустой вход → пустой массив', () => {
    expect(mergeWordTimestamps([])).toEqual([]);
  });

  it('один трек, два turn-а через большой gap', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'Привет', startMs: 0, endMs: 500 },
          { word: 'команда', startMs: 600, endMs: 1100 },
          // gap 3 секунды → новый turn
          { word: 'Работаем', startMs: 4500, endMs: 5000 },
        ],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.speaker).toBe('Алиса');
    expect(turns[0]?.text).toBe('Привет команда');
    expect(turns[1]?.text).toBe('Работаем');
  });

  it('два трека: чередование speaker', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'Как', startMs: 0, endMs: 300 },
          { word: 'дела', startMs: 350, endMs: 700 },
        ],
      },
      {
        speakerName: 'Боб',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'Хорошо', startMs: 800, endMs: 1200 },
          { word: 'спасибо', startMs: 1250, endMs: 1700 },
        ],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ speaker: 'Алиса', text: 'Как дела' });
    expect(turns[1]).toMatchObject({ speaker: 'Боб', text: 'Хорошо спасибо' });
  });

  it('одновременная речь — words разнесены по speaker, порядок по startSec', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'А', startMs: 0, endMs: 200 },
          { word: 'я', startMs: 300, endMs: 500 },
        ],
      },
      {
        speakerName: 'Боб',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          // вклинивается между «А» и «я»
          { word: 'Б', startMs: 100, endMs: 250 },
        ],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    // Должно быть 3 turn'а: Алиса("А"), Боб("Б"), Алиса("я"),
    // потому что speaker меняется → flush.
    expect(turns).toHaveLength(3);
    expect(turns.map((t) => t.speaker)).toEqual(['Алиса', 'Боб', 'Алиса']);
    expect(turns.map((t) => t.text)).toEqual(['А', 'Б', 'я']);
  });

  it('абсолютное время учитывает offset trackStartedAt', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const trackLater = new Date('2026-05-08T10:00:10.000Z'); // +10s
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [{ word: 'Раз', startMs: 0, endMs: 500 }],
      },
      {
        speakerName: 'Боб',
        trackStartedAt: trackLater,
        baseStartedAt: base,
        words: [{ word: 'Два', startMs: 0, endMs: 500 }],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.startSec).toBe(0);
    expect(turns[1]?.startSec).toBe(10); // 10 секунд offset
  });

  it('countWords и maxEndSec корректны', () => {
    const turns = [
      { speaker: 'A', text: 'один два три', startSec: 0, endSec: 5 },
      { speaker: 'B', text: 'четыре пять', startSec: 6, endSec: 9.7 },
    ];
    expect(countWords(turns)).toBe(5);
    expect(maxEndSec(turns)).toBe(10);
  });
});

describe('loadRoomChatForMerge', () => {
  /** Хэлпер: типизированные моки PrismaService.meetingRoomMessage и cfg. */
  function makeDeps(opts: {
    includeRoomChat: boolean;
    rows: Array<{ authorName: string; content: string; sentAt: Date }>;
  }): { prisma: PrismaService; cfg: TypedConfigService; findMany: ReturnType<typeof vi.fn> } {
    const findMany = vi.fn().mockResolvedValue(opts.rows);
    const prisma = {
      meetingRoomMessage: { findMany },
    } as unknown as PrismaService;
    const cfg = {
      aiFeatures: { includeRoomChat: opts.includeRoomChat },
    } as unknown as TypedConfigService;
    return { prisma, cfg, findMany };
  }

  it('includeRoomChat=true + 3 сообщения → массив в порядке sentAt asc', async () => {
    const sentAt1 = new Date('2026-05-08T10:00:05.000Z');
    const sentAt2 = new Date('2026-05-08T10:00:30.000Z');
    const sentAt3 = new Date('2026-05-08T10:01:00.000Z');
    const { prisma, cfg, findMany } = makeDeps({
      includeRoomChat: true,
      rows: [
        { authorName: 'Алиса', content: 'привет', sentAt: sentAt1 },
        { authorName: 'Боб', content: 'https://example.com/doc', sentAt: sentAt2 },
        { authorName: 'Алиса', content: 'договорились на пятницу', sentAt: sentAt3 },
      ],
    });

    const result = await loadRoomChatForMerge({ prisma, cfg, meetingId: 'm-1' });

    expect(findMany).toHaveBeenCalledWith({
      where: { meetingId: 'm-1' },
      orderBy: { sentAt: 'asc' },
      select: { authorName: true, content: true, sentAt: true },
    });
    expect(result).toEqual([
      { authorName: 'Алиса', content: 'привет', sentAt: sentAt1.toISOString() },
      {
        authorName: 'Боб',
        content: 'https://example.com/doc',
        sentAt: sentAt2.toISOString(),
      },
      {
        authorName: 'Алиса',
        content: 'договорились на пятницу',
        sentAt: sentAt3.toISOString(),
      },
    ]);
  });

  it('includeRoomChat=true, нет сообщений → null (ключ не добавляется)', async () => {
    const { prisma, cfg, findMany } = makeDeps({
      includeRoomChat: true,
      rows: [],
    });

    const result = await loadRoomChatForMerge({ prisma, cfg, meetingId: 'm-2' });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('includeRoomChat=false → null без обращения к БД', async () => {
    const { prisma, cfg, findMany } = makeDeps({
      includeRoomChat: false,
      rows: [
        // эти сообщения не должны быть прочитаны вообще, но кладём чтобы
        // убедиться, что флаг отключает БД-запрос полностью.
        {
          authorName: 'Алиса',
          content: 'это не должно попасть в AI',
          sentAt: new Date('2026-05-08T10:00:00.000Z'),
        },
      ],
    });

    const result = await loadRoomChatForMerge({ prisma, cfg, meetingId: 'm-3' });

    expect(result).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
