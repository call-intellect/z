import { writeFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { S3Service } from '../s3.service';

import { FaststartWorker } from './faststart.worker';

/**
 * Тестовый подкласс: переопределяет `runFfmpeg`, чтобы не звать реальный ffmpeg —
 * вместо этого «эмулирует» его, записывая out-файл (последний аргумент) копией
 * src. Так `readFile(outPath)` в `processMeeting` отрабатывает на реальном fs.
 */
class TestFaststartWorker extends FaststartWorker {
  public ffmpegCalls: string[][] = [];

  protected override async runFfmpeg(args: string[]): Promise<void> {
    this.ffmpegCalls.push(args);
    const outPath = args[args.length - 1];
    if (!outPath) throw new Error('test runFfmpeg: нет out-пути в args');
    await writeFile(outPath, Buffer.from('FASTSTART_MP4'));
  }
}

function make(setup: {
  faststartEnabled?: boolean;
  recording?: { mainVideoUrl: string | null; bytesTotal?: number | bigint | null } | null;
  minBytes?: number;
}): {
  worker: TestFaststartWorker;
  prisma: any;
  s3: any;
} {
  const prisma = {
    recording: {
      findUnique: vi.fn(async () =>
        setup.recording === undefined ? { mainVideoUrl: null } : setup.recording,
      ),
    },
  } as unknown as PrismaService;

  const s3 = {
    getObject: vi.fn(async () => Buffer.from('SRC_MP4_WITH_MOOV_AT_END')),
    putObject: vi.fn(async () => undefined),
  } as unknown as S3Service;

  const redis = { client: {} } as unknown as RedisService;

  const cfg = {
    recording: {
      faststartEnabled: setup.faststartEnabled ?? true,
      faststartMinBytes: setup.minBytes ?? 52_428_800,
    },
    s3: { bucket: 'z-records' },
  } as unknown as TypedConfigService;

  const worker = new TestFaststartWorker(redis, prisma, s3, cfg);
  return { worker, prisma, s3 };
}

describe('FaststartWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('флаг выключен → skip (не качает и не заливает)', async () => {
    const { worker, s3 } = make({
      faststartEnabled: false,
      recording: { mainVideoUrl: 'https://s3.local/z-records/meetings/m-1/composite.mp4' },
    });

    await worker.processMeeting('m-1');

    expect((s3 as any).getObject).not.toHaveBeenCalled();
    expect((s3 as any).putObject).not.toHaveBeenCalled();
  });

  it('нет mainVideoUrl → skip', async () => {
    const { worker, s3 } = make({ recording: { mainVideoUrl: null } });

    await worker.processMeeting('m-1');

    expect((s3 as any).getObject).not.toHaveBeenCalled();
    expect((s3 as any).putObject).not.toHaveBeenCalled();
  });

  it('записи нет → skip', async () => {
    const { worker, s3 } = make({ recording: null });

    await worker.processMeeting('m-1');

    expect((s3 as any).getObject).not.toHaveBeenCalled();
  });

  it('composite меньше порога (bytesTotal < minBytes) → skip', async () => {
    const { worker, s3 } = make({
      recording: {
        mainVideoUrl: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
        bytesTotal: 1_000_000, // 1 МБ < 50 МиБ
      },
    });

    await worker.processMeeting('m-1');

    expect((s3 as any).getObject).not.toHaveBeenCalled();
    expect((s3 as any).putObject).not.toHaveBeenCalled();
  });

  it('happy path: качает composite, гонит ffmpeg +faststart, перезаливает по тому же ключу', async () => {
    const { worker, s3 } = make({
      recording: {
        mainVideoUrl: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
        bytesTotal: 400 * 1024 * 1024, // 400 МБ > порога
      },
    });

    await worker.processMeeting('m-1');

    // Ключ извлечён из полного URL.
    expect((s3 as any).getObject).toHaveBeenCalledWith('meetings/m-1/composite.mp4');
    // ffmpeg вызван с -movflags +faststart и -c copy.
    expect(worker.ffmpegCalls).toHaveLength(1);
    expect(worker.ffmpegCalls[0]).toEqual(
      expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart']),
    );
    // Перезалив по тому же ключу как video/mp4.
    expect((s3 as any).putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'meetings/m-1/composite.mp4',
        contentType: 'video/mp4',
      }),
    );
  });
});
