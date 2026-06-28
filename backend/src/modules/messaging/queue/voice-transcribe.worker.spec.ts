import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { VoxService } from '../../ai/services/vox.service';
import type { S3Service } from '../../recordings/s3.service';

import type { ChatIngestQueueService } from './chat-ingest.queue.service';
import { VoiceTranscribeWorker } from './voice-transcribe.worker';

function build(opts: {
  message?: Record<string, unknown> | null;
  feedsGraph?: boolean;
  transcriptText?: string;
}) {
  const messageRow =
    opts.message === null
      ? null
      : {
          id: 'msg-1',
          conversationId: 'conv-1',
          voiceUrl: 'meetings/x/audio/a.ogg',
          voiceTranscript: null,
          ...opts.message,
        };

  const updateFn = vi.fn().mockResolvedValue({});
  const prisma = {
    message: { findUnique: vi.fn().mockResolvedValue(messageRow), update: updateFn },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ feedsGraph: opts.feedsGraph ?? true }),
    },
  } as unknown as PrismaService;

  const submitFn = vi.fn().mockResolvedValue({ taskId: 'task-1' });
  const pollFn = vi.fn().mockResolvedValue({
    status: 'COMPLETED',
    transcriptText: opts.transcriptText ?? 'привет это голосовое',
    durationSeconds: 3,
  });
  const vox = { submit: submitFn, poll: pollFn } as unknown as VoxService;

  const getObjectFn = vi.fn().mockResolvedValue(Buffer.from('audio'));
  const s3 = { getObject: getObjectFn } as unknown as S3Service;

  const cfg = {
    s3: { bucket: 'kora' },
    ai: { vox: { pollIntervalMs: 1, pollMaxAttempts: 1 } },
  } as unknown as TypedConfigService;

  const chatIngestEnqueue = vi.fn().mockResolvedValue(undefined);
  const chatIngestQueue = { enqueue: chatIngestEnqueue } as unknown as ChatIngestQueueService;
  const redis = { client: {} } as unknown as RedisService;

  const worker = new VoiceTranscribeWorker(redis, prisma, vox, s3, cfg, chatIngestQueue);
  return { worker, submitFn, pollFn, updateFn, getObjectFn, chatIngestEnqueue };
}

describe('VoiceTranscribeWorker.transcribe', () => {
  it('voiceUrl есть → vox вызван, voiceTranscript записан, chat.ingest re-enqueue', async () => {
    const { worker, submitFn, updateFn, getObjectFn, chatIngestEnqueue } = build({});

    await worker.transcribe('msg-1');

    expect(getObjectFn).toHaveBeenCalledTimes(1);
    expect(submitFn).toHaveBeenCalledTimes(1);
    expect(updateFn).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { voiceTranscript: 'привет это голосовое' },
    });
    expect(chatIngestEnqueue).toHaveBeenCalledWith('msg-1');
  });

  it('voiceTranscript уже есть → skip (vox НЕ вызван)', async () => {
    const { worker, submitFn, updateFn } = build({
      message: { voiceTranscript: 'уже расшифровано' },
    });

    await worker.transcribe('msg-1');

    expect(submitFn).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('нет voiceUrl → skip', async () => {
    const { worker, submitFn } = build({ message: { voiceUrl: null } });

    await worker.transcribe('msg-1');

    expect(submitFn).not.toHaveBeenCalled();
  });

  it('feedsGraph=false → транскрипт записан, но chat.ingest НЕ re-enqueue', async () => {
    const { worker, updateFn, chatIngestEnqueue } = build({ feedsGraph: false });

    await worker.transcribe('msg-1');

    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(chatIngestEnqueue).not.toHaveBeenCalled();
  });
});
