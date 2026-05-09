import { createHash, createHmac } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { TypedConfigService } from '../../src/common/config/index';
import { GlobalZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AiQueueService } from '../../src/modules/ai/ai-queue.service';
import { HmacService } from '../../src/modules/auth/services/hmac.service';
import { LivekitService } from '../../src/modules/livekit/livekit.service';
import { LivekitEgressClient } from '../../src/modules/recordings/livekit-egress.client';
import { S3Service } from '../../src/modules/recordings/s3.service';

/**
 * E2E `ai-pipeline`:
 *   1. Прокачиваем встречу до `recording_ready` через webhook'и.
 *   2. Проверяем, что `AiQueueService.enqueueTranscribe(meetingId)` был вызван.
 *      (Сам worker мы тут не запускаем — это в юнит-тестах воркеров.)
 *   3. Имитируем `failed` встречу и проверяем `POST /api/v1/meetings/:id/retry-ai`.
 *
 * AiQueueService подменяем — реальный Redis-Queue недоступен в тестах.
 */
describe('AI Pipeline E2E (smoke)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hmacService: HmacService;
  let cfg: TypedConfigService;
  let plainKey: string;
  let enqueueCalls: { stage: string; meetingId: string }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // LivekitService → mock
    const livekit = moduleRef.get(LivekitService, { strict: false });
    Object.assign(livekit, {
      ensureRoom: async () => null,
      deleteRoom: async () => undefined,
      listParticipants: async () => [],
      generateHostToken: async () => 'mock-host-token',
      generateGuestToken: async () => 'mock-guest-token',
      muteParticipant: async () => undefined,
      removeParticipant: async () => undefined,
      updateParticipantAttributes: async () => undefined,
    });

    // Egress → mock
    const egress = moduleRef.get(LivekitEgressClient, { strict: false });
    Object.assign(egress, {
      startRoomCompositeEgress: async () => ({ egressId: 'EG_C1' }),
      startTrackEgress: async () => ({ egressId: 'EG_T1' }),
      stopEgress: async () => undefined,
    });

    // S3 → mock
    const s3 = moduleRef.get(S3Service, { strict: false });
    Object.assign(s3, {
      presignGet: async (key: string) => ({
        url: `https://signed.local/${key}`,
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      delete: async () => undefined,
      getObject: async () => Buffer.from('mock'),
      putJson: async () => undefined,
      getJson: async () => ({}),
    });

    // AiQueueService → mock (фиксируем вызовы enqueue)
    enqueueCalls = [];
    const queue = moduleRef.get(AiQueueService, { strict: false });
    Object.assign(queue, {
      enqueueTranscribe: async (meetingId: string) => {
        enqueueCalls.push({ stage: 'transcribe', meetingId });
      },
      enqueueMerge: async (meetingId: string) => {
        enqueueCalls.push({ stage: 'merge', meetingId });
      },
      enqueueAnalyze: async (meetingId: string) => {
        enqueueCalls.push({ stage: 'analyze', meetingId });
      },
      enqueueNotify: async (meetingId: string) => {
        enqueueCalls.push({ stage: 'notify', meetingId });
      },
      onModuleInit: () => undefined,
      onModuleDestroy: async () => undefined,
    });

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(
      express.json({
        limit: '1mb',
        verify: (req, _res, buf) => {
          (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        },
      }),
    );
    app.use(cookieParser());
    app.useGlobalPipes(new GlobalZodValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    hmacService = app.get(HmacService);
    cfg = app.get(TypedConfigService);

    plainKey = hmacService.generateKey();
    await prisma.integrationKey.create({
      data: {
        partnerName: 'ai-pipeline-e2e',
        keyHash: hmacService.hashKey(plainKey),
      },
    });
  });

  afterEach(async () => {
    await prisma.$transaction([
      prisma.aiUsageLog.deleteMany(),
      prisma.aiResult.deleteMany(),
      prisma.transcript.deleteMany(),
      prisma.crossmarkIdempotency.deleteMany(),
      prisma.webhookSeenEvent.deleteMany(),
      prisma.recordingAction.deleteMany(),
      prisma.audioTrack.deleteMany(),
      prisma.recording.deleteMany(),
      prisma.meetingEvent.deleteMany(),
      prisma.participant.deleteMany(),
      prisma.meeting.deleteMany(),
      prisma.user.deleteMany(),
    ]);
    enqueueCalls.length = 0;
  });

  afterAll(async () => {
    await prisma.integrationKey.deleteMany({
      where: { partnerName: 'ai-pipeline-e2e' },
    });
    await prisma.webhookSeenEvent.deleteMany();
    await app.close();
  });

  // ───────────────────── helpers ─────────────────────

  function signCrossmark(body: string, ts: number): string {
    return createHmac('sha256', plainKey).update(`${ts}.${body}`).digest('hex');
  }

  function crossmarkAuth(body: string): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000);
    return {
      Authorization: `Bearer ${plainKey}`,
      'X-Crossmark-Signature': signCrossmark(body, ts),
      'X-Crossmark-Timestamp': String(ts),
    };
  }

  function signLivekitWebhook(body: string): string {
    const sha256 = createHash('sha256').update(body).digest('base64');
    return jwt.sign({ sha256 }, cfg.livekit.webhookApiSecret, {
      algorithm: 'HS256',
      expiresIn: 60,
    });
  }

  const canonicalize = (obj: unknown): string =>
    JSON.stringify(JSON.parse(JSON.stringify(obj)));

  async function postWebhook(payload: unknown): Promise<void> {
    const str = canonicalize(payload);
    const auth = signLivekitWebhook(str);
    const res = await request(app.getHttpServer())
      .post('/webhooks/livekit')
      .set('Content-Type', 'application/json')
      .set('Authorization', auth)
      .send(str);
    expect(res.status).toBe(200);
  }

  async function createMeeting(): Promise<{ meetingId: string; cookie: string }> {
    const createBody = JSON.stringify({
      host: { external_id: 'u-ai', email: 'ai@x.com', name: 'AI Host' },
      type: 'sales',
      title: 'AI Pipeline E2E',
    });
    const createRes = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(crossmarkAuth(createBody))
      .set('Content-Type', 'application/json')
      .send(createBody);
    expect(createRes.status).toBe(201);
    const meetingId = createRes.body.meeting_id as string;
    const deepLinkUrl = createRes.body.deep_link as string;
    const tokenMatch = /\?t=([^&]+)/.exec(deepLinkUrl);
    const deepLinkToken = decodeURIComponent(tokenMatch?.[1] ?? '');

    const exchangeRes = await request(app.getHttpServer())
      .get('/api/v1/auth/exchange')
      .query({ token: deepLinkToken, meeting_id: meetingId });
    expect(exchangeRes.status).toBe(200);
    const setCookie = exchangeRes.headers['set-cookie'] as unknown as
      | string[]
      | string;
    const fullCookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
      (c: string) => c.startsWith('z_session='),
    );
    const cookie = (fullCookie ?? '').split(';')[0] ?? '';
    return { meetingId, cookie };
  }

  // ───────────────────── сценарий 1 ──────────────────

  it('recording_ready → enqueueTranscribe вызван', async () => {
    const { meetingId, cookie } = await createMeeting();
    void cookie;

    // room_started → active
    await postWebhook({
      event: 'room_started',
      id: 'evt-rs-1',
      room: { name: meetingId },
    });

    // Создаём Recording (минуем /recording/start — он ходит в Egress).
    await prisma.recording.create({
      data: {
        meetingId,
        status: 'recording',
        retentionDays: 30,
        expiresAt: new Date(Date.now() + 30 * 86400_000),
        compositeEgressId: 'EG_C1',
      },
    });

    // room_finished → completed
    await postWebhook({
      event: 'room_finished',
      id: 'evt-rf-1',
      room: { name: meetingId },
    });

    // egress_ended composite
    await postWebhook({
      event: 'egress_ended',
      id: 'evt-eg-end-1',
      room: { name: meetingId },
      egressInfo: {
        egressId: 'EG_C1',
        request: { case: 'roomComposite' },
        fileResults: [
          {
            location: `s3://bucket/meetings/${meetingId}/composite.mp4`,
            size: 1000,
            duration: 60_000_000_000,
          },
        ],
      },
    });

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(meeting?.status).toBe('recording_ready');
    expect(enqueueCalls.some((c) => c.stage === 'transcribe' && c.meetingId === meetingId)).toBe(true);
  });

  // ───────────────────── сценарий 2 ──────────────────

  it('failed-встреча → POST /retry-ai возвращает stage=transcribe', async () => {
    const { meetingId, cookie } = await createMeeting();

    // Устанавливаем встречу в failed напрямую.
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'failed', failureReason: 'transcribe: timeout' },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/meetings/${meetingId}/retry-ai`)
      .set('Cookie', cookie)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stage).toBe('transcribe');

    const after = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(after?.status).toBe('recording_ready');
    expect(after?.failureReason).toBeNull();
    expect(enqueueCalls.some((c) => c.stage === 'transcribe' && c.meetingId === meetingId)).toBe(true);
  });
});
