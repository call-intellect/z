import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { S3Service } from '../../recordings/s3.service';

import { VoiceNoteAudioRetentionCron } from './voice-note-audio-retention.cron';

function buildCron(opts: {
  candidates: Array<{ id: string; payload: unknown }>;
  retentionDays?: number;
  s3Delete?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  const findMany = vi.fn(async () => opts.candidates);
  const update = opts.update ?? vi.fn(async () => undefined);
  const prisma = {
    rawEvent: { findMany, update },
  } as unknown as PrismaService;
  const s3Delete = opts.s3Delete ?? vi.fn(async () => undefined);
  const s3 = { delete: s3Delete } as unknown as S3Service;
  const cfg = {
    getDynamic: vi.fn(async (_k: string, _e: unknown, def: unknown) =>
      opts.retentionDays ?? def,
    ),
  } as unknown as TypedConfigService;
  return {
    cron: new VoiceNoteAudioRetentionCron(prisma, s3, cfg),
    findMany,
    update,
    s3Delete,
  };
}

describe('VoiceNoteAudioRetentionCron.sweep', () => {
  it('старше retention с audioS3Key → удаляет S3 и обнуляет ключ в payload', async () => {
    const { cron, s3Delete, update } = buildCron({
      candidates: [
        {
          id: 'raw-1',
          payload: {
            kind: 'free_note',
            metadata: { source: 'telegram_bot', audioS3Key: 'voice-notes/t-1/a.ogg' },
          },
        },
      ],
    });
    const res = await cron.sweep();
    expect(res.deleted).toBe(1);
    expect(s3Delete).toHaveBeenCalledWith(['voice-notes/t-1/a.ogg']);
    const updateArg = (update.mock.calls as unknown[][])[0]![0] as {
      data: { payload: { metadata: { audioS3Key: unknown } } };
    };
    expect(updateArg.data.payload.metadata.audioS3Key).toBeNull();
  });

  it('кандидат без audioS3Key → не трогает (no-op)', async () => {
    const { cron, s3Delete, update } = buildCron({
      candidates: [
        { id: 'raw-1', payload: { metadata: { source: 'telegram_bot' } } },
      ],
    });
    const res = await cron.sweep();
    expect(res.deleted).toBe(0);
    expect(s3Delete).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('идемпотентность: повторный проход без кандидатов → 0 удалений', async () => {
    const { cron, s3Delete } = buildCron({ candidates: [] });
    const res = await cron.sweep();
    expect(res.deleted).toBe(0);
    expect(s3Delete).not.toHaveBeenCalled();
  });

  it('сбой S3 на одном объекте не валит весь проход', async () => {
    const s3Delete = vi
      .fn()
      .mockRejectedValueOnce(new Error('s3 down'))
      .mockResolvedValueOnce(undefined);
    const { cron } = buildCron({
      candidates: [
        { id: 'raw-1', payload: { metadata: { audioS3Key: 'voice-notes/t-1/a.ogg' } } },
        { id: 'raw-2', payload: { metadata: { audioS3Key: 'voice-notes/t-1/b.ogg' } } },
      ],
      s3Delete,
    });
    const res = await cron.sweep();
    expect(res.deleted).toBe(1);
  });

  it('сохраняет остальные поля metadata при обнулении audioS3Key', async () => {
    const update = vi.fn(async () => undefined);
    const { cron } = buildCron({
      candidates: [
        {
          id: 'raw-1',
          payload: {
            kind: 'free_note',
            userId: 'u-1',
            metadata: {
              source: 'telegram_bot',
              kind: 'voice',
              audioS3Key: 'voice-notes/t-1/a.ogg',
            },
          },
        },
      ],
      update,
    });
    await cron.sweep();
    const updateArg = (update.mock.calls as unknown[][])[0]![0] as {
      data: { payload: { kind: string; metadata: { source: string; kind: string } } };
    };
    expect(updateArg.data.payload.kind).toBe('free_note');
    expect(updateArg.data.payload.metadata.source).toBe('telegram_bot');
    expect(updateArg.data.payload.metadata.kind).toBe('voice');
  });
});
